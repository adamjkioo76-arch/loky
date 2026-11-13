import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bell, Check, ChevronDown,
  CircleHelp, CreditCard, Download, LayoutDashboard, LogOut, Menu, Plus,
  Search, Settings, ShieldCheck, Sparkles, Target, Trash2, TrendingUp,
  Wallet, X,
} from "lucide-react";
import { supabase } from "./lib/supabase.js";
import { calculateBudgetUsage, calculateDistribution, sumTransactions, toMinorUnits } from "./lib/finance.js";
import "./finance.css";

const navigation = [
  ["dashboard", "الرئيسية", LayoutDashboard],
  ["transactions", "المعاملات", ArrowLeftRight],
  ["accounts", "الحسابات", Wallet],
  ["budgets", "الميزانيات", CreditCard],
  ["goals", "أهداف الادخار", Target],
  ["reports", "التقارير", TrendingUp],
  ["notifications", "الإشعارات", Bell],
  ["assistant", "المساعد الذكي", Sparkles],
  ["settings", "الإعدادات", Settings],
];
const pageTitles = Object.fromEntries(navigation.map(([id, title]) => [id, title]));
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = { kind: "expense", amount: "", category_id: "", account_id: "", transaction_date: today(), description: "", notes: "" };

function money(minor, currency = "EGP") {
  const amount = BigInt(minor || 0);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  const number = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(whole);
  return `${amount < 0n ? "−" : ""}${number}٫${fraction} ${currency}`;
}
function minorUnits(value) {
  return toMinorUnits(value);
}
function majorUnitsText(value) {
  const minor = BigInt(value);
  return `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
}
function dateMinusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}
function budgetRange(budget, date = today()) {
  if (date < budget.starts_on) return null;
  if (budget.period === "custom") return { start: budget.starts_on, end: budget.ends_on || date };
  const end = new Date(`${date}T00:00:00`);
  let start;
  if (budget.period === "weekly") {
    start = new Date(end);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    if (start.toISOString().slice(0, 10) < budget.starts_on) start = new Date(`${budget.starts_on}T00:00:00`);
    const weekEnd = new Date(start);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: weekEnd.toISOString().slice(0, 10) };
  }
  start = new Date(end.getFullYear(), end.getMonth(), 1);
  if (start.toISOString().slice(0, 10) < budget.starts_on) start = new Date(`${budget.starts_on}T00:00:00`);
  const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: monthEnd.toISOString().slice(0, 10) };
}
function localizedError(error) {
  const message = error?.message || "";
  if (/insufficient funds/i.test(message)) return "الرصيد المتاح في الحساب لا يكفي لهذا التحويل.";
  if (/duplicate key/i.test(message)) return "هذه البيانات موجودة بالفعل.";
  if (/permission|row-level security/i.test(message)) return "ليس لديك صلاحية لتنفيذ هذا الإجراء.";
  if (/network|fetch/i.test(message)) return "تعذر الاتصال بالخدمة. تحقق من الإنترنت وحاول مجدداً.";
  return message ? `تعذر إكمال العملية: ${message}` : "حدث خطأ غير متوقع.";
}
function assertResult(result) {
  if (result.error) throw result.error;
  return result.data;
}
async function loadAllTransactions() {
  const allTransactions = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = assertResult(await supabase.from("transactions").select("*")
      .order("transaction_date", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + pageSize - 1));
    allTransactions.push(...page);
    if (page.length < pageSize) return { data: allTransactions, error: null };
  }
}

export default function FinanceApp({ session, onSignedOut }) {
  const [active, setActive] = useState("dashboard");
  const [data, setData] = useState({ profile: null, preferences: null, accounts: [], categories: [], transactions: [], budgets: [], goals: [], notifications: [], salary: null, cycles: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [transactionForm, setTransactionForm] = useState(emptyForm);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [modal, setModal] = useState("");
  const [accountForm, setAccountForm] = useState({ name: "", color: "#f44067", icon: "wallet" });
  const [budgetForm, setBudgetForm] = useState({ name: "", amount: "", period: "monthly", starts_on: today(), ends_on: "", category_id: "" });
  const [goalForm, setGoalForm] = useState({ name: "", target: "", target_date: "", icon: "target" });
  const [transferForm, setTransferForm] = useState({ from: "", to: "", amount: "", description: "", idempotency_key: "" });
  const [contributionForm, setContributionForm] = useState({ goal_id: "", from_account: "", amount: "", idempotency_key: "" });
  const [profileForm, setProfileForm] = useState({ full_name: "", currency: "EGP", theme: "dark" });
  const [salaryForm, setSalaryForm] = useState({ enabled: false, salary: "", pay_day: "", cycle_days: "30", auto_save_enabled: false, auto_save_percent: "100", savings_account_id: "" });
  const [categoryForm, setCategoryForm] = useState({ name: "", kind: "expense", color: "#ff875c" });
  const [reportPeriod, setReportPeriod] = useState("month");

  const loadData = useCallback(async () => {
    setError("");
    const tables = await Promise.all([
      supabase.from("profiles").select("full_name").maybeSingle(),
      supabase.from("user_preferences").select("currency,theme,locale").maybeSingle(),
      supabase.from("account_balances").select("*").order("name"),
      supabase.from("categories").select("id,name,kind,color").order("name"),
      loadAllTransactions(),
      supabase.from("budgets").select("*").order("created_at", { ascending: false }),
      supabase.from("budget_categories").select("budget_id,category_id"),
      supabase.from("savings_goals").select("*").order("created_at", { ascending: false }),
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("salary_settings").select("*").maybeSingle(),
      supabase.from("salary_cycles").select("*").order("starts_on", { ascending: false }).limit(50),
    ]);
    const [profile, preferences, accounts, categories, transactions, budgets, budgetCategories, goals, notifications, salary, cycles] = tables.map(assertResult);
    const next = {
      profile, preferences, accounts: accounts || [], categories: categories || [], transactions: transactions || [],
      budgets: budgets || [], budgetCategories: budgetCategories || [], goals: goals || [], notifications: notifications || [], salary, cycles: cycles || [],
    };
    setData(next);
    setProfileForm({ full_name: profile?.full_name || "", currency: preferences?.currency || "EGP", theme: preferences?.theme || "dark" });
    setSalaryForm({
      enabled: salary?.enabled || false, salary: salary?.salary_minor ? majorUnitsText(salary.salary_minor) : "",
      pay_day: salary?.pay_day ? String(salary.pay_day) : "", cycle_days: String(salary?.cycle_days || 30),
      auto_save_enabled: salary?.auto_save_enabled || false, auto_save_percent: String(salary?.auto_save_percent || 100),
      savings_account_id: salary?.savings_account_id || "",
    });
  }, []);

  useEffect(() => {
    let activeEffect = true;
    loadData().catch((cause) => { if (activeEffect) setError(localizedError(cause)); })
      .finally(() => { if (activeEffect) setLoading(false); });
    return () => { activeEffect = false; };
  }, [loadData]);

  useEffect(() => {
    if (!mobileMenu) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileMenu(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenu]);

  const run = async (operation, successText = "") => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await operation();
      await loadData();
      if (successText) setSuccess(successText);
      setModal("");
    } catch (cause) {
      setError(localizedError(cause));
    } finally {
      setBusy(false);
    }
  };

  const currency = data.preferences?.currency || "EGP";
  const unreadCount = data.notifications.filter((item) => !item.read_at).length;
  const pageTransactions = useMemo(() => data.transactions.filter((item) => {
    const text = `${item.description} ${item.notes}`.toLowerCase();
    return !query || text.includes(query.toLowerCase());
  }), [data.transactions, query]);
  const periodStart = reportPeriod === "month"
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
    : reportPeriod === "previous" ? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10)
      : dateMinusDays(29);
  const periodEnd = reportPeriod === "previous"
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10)
    : today();
  const dashboardTransactions = data.transactions.filter((item) => item.transaction_date >= dateMinusDays(29));
  const reportTransactions = data.transactions.filter((item) => item.transaction_date >= periodStart && item.transaction_date <= periodEnd);
  const totals = {
    income: sumTransactions(dashboardTransactions, (item) => item.kind === "income"),
    expense: sumTransactions(dashboardTransactions, (item) => item.kind === "expense"),
    saved: sumTransactions(dashboardTransactions, (item) => item.kind === "savings_deposit" || (
      item.kind === "transfer" && item.account_id === data.salary?.savings_account_id &&
      item.description.startsWith("[تحويل وارد]")
    )),
  };
  const totalBalance = data.accounts.reduce((sum, account) => sum + BigInt(account.balance_minor || 0), 0n);
  const remaining = totals.income - totals.expense - totals.saved;
  const expenseCategories = data.categories.filter((category) => category.kind === "expense");

  const saveTransaction = (event) => {
    event.preventDefault();
    run(async () => {
      const kind = transactionForm.kind;
      const selectedCategory = transactionForm.category_id || null;
      const payload = {
        kind, amount_minor: minorUnits(transactionForm.amount), category_id: selectedCategory,
        account_id: transactionForm.account_id, transaction_date: transactionForm.transaction_date,
        description: transactionForm.description.trim(), notes: transactionForm.notes.trim(),
      };
      if (editingTransaction) {
        assertResult(await supabase.from("transactions").update(payload).eq("id", editingTransaction).select().single());
      } else {
        assertResult(await supabase.from("transactions").insert(payload).select().single());
      }
      setTransactionForm(emptyForm);
      setEditingTransaction(null);
    }, editingTransaction ? "تم تحديث المعاملة." : "تمت إضافة المعاملة.");
  };

  const signOut = async () => {
    setBusy(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      onSignedOut();
    } catch (cause) {
      setError(localizedError(cause));
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordChange = () => {
    if (!session.user.email) {
      setError("لا يوجد بريد إلكتروني مؤكد لهذا الحساب.");
      return;
    }
    run(() => supabase.auth.resetPasswordForEmail(session.user.email, {
      redirectTo: new URL(
        "?mode=update-password",
        new URL(import.meta.env.BASE_URL, window.location.href),
      ).toString(),
    }).then(assertResult), "أرسلنا رابط تغيير كلمة المرور إلى بريدك الإلكتروني.");
  };

  const askAssistant = async (question) => {
    setAiBusy(true);
    setError("");
    setAiAnswer("");
    try {
      const { data: response, error: requestError } = await supabase.functions.invoke("lumora-ai", {
        body: { question },
      });
      if (requestError) throw requestError;
      if (!response?.answer) throw new Error("لم يرجع المساعد إجابة.");
      setAiAnswer(response.answer);
    } catch (cause) {
      setError(localizedError(cause));
    } finally {
      setAiBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = [["التاريخ", "النوع", "المبلغ (قرش)", "التصنيف", "الحساب", "الوصف"]];
    for (const transaction of reportTransactions) {
      const category = data.categories.find((item) => item.id === transaction.category_id)?.name || "";
      const account = data.accounts.find((item) => item.account_id === transaction.account_id)?.name || "";
      rows.push([transaction.transaction_date, transaction.kind, transaction.amount_minor, category, account, transaction.description]);
    }
    const csv = `\uFEFF${rows.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `lumora-report-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className={`finance-shell ${data.preferences?.theme === "light" ? "light-theme" : ""}`}>
      <aside id="finance-navigation" className={`side-nav ${mobileMenu ? "open" : ""}`} aria-label="التنقل الرئيسي">
        <div className="finance-brand"><span className="brand-emblem">L</span><strong>LUMORA</strong></div>
        <div className="nav-label">القائمة الرئيسية</div>
        <nav>
          {navigation.map(([id, label, Icon]) => (
            <button key={id} className={`nav-item ${active === id ? "selected" : ""}`} onClick={() => { setActive(id); setMobileMenu(false); }}>
              <Icon size={18} /><span>{label}</span>
              {id === "notifications" && unreadCount > 0 && <b className="nav-badge">{unreadCount}</b>}
            </button>
          ))}
        </nav>
        <div className="nav-spacer" />
        <div className="nav-user">
          <div className="avatar">{(data.profile?.full_name || session.user.email || "م").slice(0, 1)}</div>
          <div className="user-copy"><b>{data.profile?.full_name || "مرحباً بك"}</b><span>{session.user.email}</span></div>
          <button className="icon-button" title="تسجيل الخروج" onClick={signOut} disabled={busy}><LogOut size={17} /></button>
        </div>
      </aside>
      {mobileMenu && <button className="mobile-menu-backdrop" type="button" onClick={() => setMobileMenu(false)} aria-label="إغلاق القائمة" />}

      <main className="finance-main">
        <header className="finance-topbar">
          <button className="mobile-menu-button icon-button" onClick={() => setMobileMenu((open) => !open)} aria-label="القائمة" aria-controls="finance-navigation" aria-expanded={mobileMenu}><Menu size={21} /></button>
          <div><div className="topbar-title">{pageTitles[active]}</div><div className="topbar-subtitle">أموالك بذكاء، لحياة أفضل</div></div>
          <div className="topbar-actions">
            <span className="online-indicator"><i /> متصل</span>
            <button className="icon-button notification-button" onClick={() => setActive("notifications")} aria-label="الإشعارات"><Bell size={18} />{unreadCount > 0 && <i />}</button>
            <div className="avatar top-avatar">{(data.profile?.full_name || "م").slice(0, 1)}</div>
          </div>
        </header>

        <div className="content-area">
          {error && <div className="feedback error-feedback" role="alert"><X size={16} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
          {success && <div className="feedback success-feedback" role="status"><Check size={16} /><span>{success}</span><button onClick={() => setSuccess("")}><X size={15} /></button></div>}
          {loading ? <div className="loading-state"><span className="spinner" /> جارٍ تحميل بياناتك المالية...</div> : (
            <>
              {active === "dashboard" && <Dashboard data={data} totals={totals} totalBalance={totalBalance} remaining={remaining} currency={currency} periodTransactions={dashboardTransactions} setActive={setActive} />}
              {active === "transactions" && <TransactionsPage data={data} transactions={pageTransactions} currency={currency} query={query} setQuery={setQuery} onAdd={() => { setEditingTransaction(null); setTransactionForm({ ...emptyForm, account_id: data.accounts[0]?.account_id || "", category_id: expenseCategories[0]?.id || "" }); setModal("transaction"); }} onAddCategory={() => { setCategoryForm({ name: "", kind: "expense", color: "#ff875c" }); setModal("category"); }} onEdit={(item) => { if (item.kind === "transfer") { setError("لا يمكن تعديل طرف منفرد من تحويل داخلي."); return; } setEditingTransaction(item.id); setTransactionForm({ ...item, amount: majorUnitsText(item.amount_minor), kind: item.kind, transaction_date: item.transaction_date }); setModal("transaction"); }} onDelete={(item) => { if (item.kind === "transfer") { setError("لا يمكن حذف طرف واحد من تحويل داخلي."); return; } if (window.confirm("هل تريد حذف هذه المعاملة؟")) run(() => supabase.from("transactions").delete().eq("id", item.id).then(assertResult), "تم حذف المعاملة."); }} />}
              {active === "accounts" && <AccountsPage data={data} currency={currency} onAdd={() => { setAccountForm({ name: "", color: "#f44067", icon: "wallet" }); setModal("account"); }} onEdit={(account) => { setAccountForm({ id: account.account_id, name: account.name, color: account.color, icon: account.icon }); setModal("account"); }} onTransfer={() => { setTransferForm({ from: data.accounts[0]?.account_id || "", to: data.accounts[1]?.account_id || "", amount: "", description: "", idempotency_key: crypto.randomUUID() }); setModal("transfer"); }} onArchive={(account) => { if (window.confirm(`هل تريد أرشفة حساب «${account.name}»؟`)) run(() => supabase.from("accounts").update({ is_archived: true }).eq("id", account.account_id).then(assertResult), "تمت أرشفة الحساب."); }} />}
              {active === "budgets" && <BudgetsPage data={data} currency={currency} onAdd={() => { setBudgetForm({ name: "", amount: "", period: "monthly", starts_on: today(), ends_on: "", category_id: "", alert_thresholds: "50,75,90,100" }); setModal("budget"); }} onDelete={(budget) => { if (window.confirm("حذف هذه الميزانية؟")) run(() => supabase.from("budgets").delete().eq("id", budget.id).then(assertResult), "تم حذف الميزانية."); }} />}
              {active === "goals" && <GoalsPage data={data} currency={currency} onAdd={() => { setGoalForm({ name: "", target: "", target_date: "", icon: "target" }); setModal("goal"); }} onContribute={(goal) => { setContributionForm({ goal_id: goal.id, from_account: data.accounts.find((account) => !account.is_archived && account.account_id !== data.salary?.savings_account_id)?.account_id || "", amount: "", idempotency_key: crypto.randomUUID() }); setModal("contribution"); }} onDelete={(goal) => { if (window.confirm("حذف هذا الهدف؟")) run(() => supabase.from("savings_goals").delete().eq("id", goal.id).then(assertResult), "تم حذف الهدف."); }} />}
              {active === "reports" && <ReportsPage data={data} currency={currency} start={periodStart} end={periodEnd} period={reportPeriod} setPeriod={setReportPeriod} onExport={exportCsv} />}
              {active === "notifications" && <NotificationsPage data={data} run={run} />}
              {active === "assistant" && <AssistantPage onAsk={askAssistant} answer={aiAnswer} busy={aiBusy} />}
              {active === "settings" && <SettingsPage data={data} profileForm={profileForm} setProfileForm={setProfileForm} salaryForm={salaryForm} setSalaryForm={setSalaryForm} onSaveProfile={() => run(async () => { const hasFinancialData = data.transactions.length > 0 || data.budgets.length > 0 || data.goals.length > 0 || data.cycles.length > 0 || Number(data.salary?.salary_minor || 0) > 0; if (profileForm.currency !== currency && hasFinancialData) throw new Error("لا يمكن تغيير العملة بعد تسجيل بيانات مالية؛ يلزم تحويل مبالغك بسعر صرف موثوق أولاً."); assertResult(await supabase.from("profiles").update({ full_name: profileForm.full_name.trim() }).eq("id", session.user.id)); assertResult(await supabase.from("user_preferences").upsert({ user_id: session.user.id, currency: profileForm.currency, theme: profileForm.theme })); }, "تم حفظ إعدادات الحساب.")} onChangePassword={requestPasswordChange} onSaveSalary={() => run(() => supabase.from("salary_settings").upsert({ user_id: session.user.id, enabled: salaryForm.enabled, salary_minor: salaryForm.salary && Number(salaryForm.salary) > 0 ? minorUnits(salaryForm.salary) : "0", pay_day: salaryForm.pay_day ? Number(salaryForm.pay_day) : null, cycle_days: Number(salaryForm.cycle_days), auto_save_enabled: salaryForm.auto_save_enabled, auto_save_percent: Number(salaryForm.auto_save_percent), savings_account_id: salaryForm.savings_account_id || null }).then(assertResult), "تم حفظ إعدادات الراتب.")} onStartCycle={(cycle) => run(async () => { const key = crypto.randomUUID(); await assertResult(await supabase.rpc("record_salary_cycle", { p_starts_on: cycle.starts_on, p_ends_on: cycle.ends_on, p_income_minor: minorUnits(cycle.income), p_account_id: cycle.income_account_id, p_idempotency_key: key })); }, "تم تسجيل الدورة المالية وإضافة دخلها وتطبيق إعداد الادخار.")} onReset={() => { if (window.prompt("للتأكيد اكتب RESET. سيؤدي ذلك لحذف معاملاتك وحساباتك وأهدافك وميزانياتك.") === "RESET") run(() => supabase.rpc("reset_financial_data", { p_confirmation: "RESET" }).then(assertResult), "تمت إعادة تعيين البيانات المالية."); }} onExport={exportCsv} />}
            </>
          )}
        </div>
      </main>

      {modal && <Modal title={modalTitle(modal)} onClose={() => setModal("")}>
        {modal === "transaction" && <form className="modal-form" onSubmit={saveTransaction}>
          <div className="segmented-control">{["expense", "income", "savings_deposit", "savings_withdrawal"].map((kind) => <button type="button" className={transactionForm.kind === kind ? "active" : ""} key={kind} onClick={() => setTransactionForm({ ...transactionForm, kind, category_id: "" })}>{kindLabel(kind)}</button>)}</div>
          <Field label="المبلغ"><input type="number" step="0.01" min="0.01" required value={transactionForm.amount} onChange={(e) => setTransactionForm({ ...transactionForm, amount: e.target.value })} placeholder="0.00" /></Field>
          <div className="category-select-row"><Field label="التصنيف"><select value={transactionForm.category_id} onChange={(e) => setTransactionForm({ ...transactionForm, category_id: e.target.value })}><option value="">بدون تصنيف</option>{data.categories.filter((c) => c.kind === (transactionForm.kind === "income" ? "income" : "expense")).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><button className="secondary-button" type="button" onClick={() => { setCategoryForm({ name: "", kind: transactionForm.kind === "income" ? "income" : "expense", color: "#ff875c" }); setModal("category"); }}>تصنيف جديد</button></div>
          <Field label="الحساب"><select required value={transactionForm.account_id} onChange={(e) => setTransactionForm({ ...transactionForm, account_id: e.target.value })}>{data.accounts.filter((a) => !a.is_archived).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</select></Field>
          <Field label="التاريخ"><input type="date" required value={transactionForm.transaction_date} onChange={(e) => setTransactionForm({ ...transactionForm, transaction_date: e.target.value })} /></Field>
          <Field label="الوصف"><input maxLength="240" value={transactionForm.description} onChange={(e) => setTransactionForm({ ...transactionForm, description: e.target.value })} placeholder="مثال: فاتورة الكهرباء" /></Field>
          <Field label="ملاحظات (اختياري)"><textarea maxLength="2000" value={transactionForm.notes} onChange={(e) => setTransactionForm({ ...transactionForm, notes: e.target.value })} /></Field>
          <ModalSubmit busy={busy}>{editingTransaction ? "حفظ التعديلات" : "إضافة المعاملة"}</ModalSubmit>
        </form>}
        {modal === "account" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const operation = accountForm.id ? supabase.from("accounts").update({ name: accountForm.name.trim(), color: accountForm.color, icon: accountForm.icon }).eq("id", accountForm.id) : supabase.from("accounts").insert({ name: accountForm.name.trim(), color: accountForm.color, icon: accountForm.icon }); run(() => operation.then(assertResult), "تم حفظ الحساب."); }}>
          <Field label="اسم الحساب"><input required minLength="1" maxLength="80" value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="مثال: مدخرات السفر" /></Field>
          <Field label="اللون"><input type="color" value={accountForm.color} onChange={(e) => setAccountForm({ ...accountForm, color: e.target.value })} /></Field>
          <ModalSubmit busy={busy}>حفظ الحساب</ModalSubmit>
        </form>}
        {modal === "transfer" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (transferForm.from === transferForm.to) { setError("اختر حسابين مختلفين للتحويل."); return; } run(() => supabase.rpc("transfer_between_accounts", { p_from_account: transferForm.from, p_to_account: transferForm.to, p_amount_minor: minorUnits(transferForm.amount), p_transfer_date: today(), p_description: transferForm.description, p_idempotency_key: transferForm.idempotency_key }).then(assertResult), "تم التحويل بين الحسابين."); }}>
          <Field label="من حساب"><select value={transferForm.from} onChange={(e) => setTransferForm({ ...transferForm, from: e.target.value })}>{data.accounts.filter((a) => !a.is_archived).map((a) => <option value={a.account_id} key={a.account_id}>{a.name} — {money(a.balance_minor, currency)}</option>)}</select></Field>
          <Field label="إلى حساب"><select value={transferForm.to} onChange={(e) => setTransferForm({ ...transferForm, to: e.target.value })}>{data.accounts.filter((a) => !a.is_archived).map((a) => <option value={a.account_id} key={a.account_id}>{a.name}</option>)}</select></Field>
          <Field label="المبلغ"><input type="number" min="0.01" step="0.01" required value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} /></Field>
          <Field label="الوصف"><input maxLength="200" value={transferForm.description} onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} /></Field>
          <p className="modal-hint">يتم تسجيل طرفي التحويل معاً داخل معاملة قاعدة بيانات واحدة.</p>
          <ModalSubmit busy={busy}>تأكيد التحويل</ModalSubmit>
        </form>}
        {modal === "budget" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(async () => { const thresholds = budgetForm.alert_thresholds.split(",").map((value) => Number(value.trim())); if (!thresholds.length || thresholds.length > 10 || thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100)) throw new Error("أدخل بين مستوى واحد وعشرة مستويات تنبيه صحيحة من 1 إلى 100."); const budget = assertResult(await supabase.from("budgets").insert({ name: budgetForm.name.trim(), amount_minor: minorUnits(budgetForm.amount), period: budgetForm.period, starts_on: budgetForm.starts_on, ends_on: budgetForm.ends_on || null, alert_thresholds: thresholds }).select("id").single()); if (budgetForm.category_id) assertResult(await supabase.from("budget_categories").insert({ budget_id: budget.id, category_id: budgetForm.category_id })); }, "تم إنشاء الميزانية."); }}>
          <Field label="اسم الميزانية"><input required maxLength="80" value={budgetForm.name} onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })} /></Field>
          <Field label="المبلغ"><input type="number" step="0.01" min="0.01" required value={budgetForm.amount} onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })} /></Field>
          <Field label="الفترة"><select value={budgetForm.period} onChange={(e) => setBudgetForm({ ...budgetForm, period: e.target.value })}><option value="weekly">أسبوعية</option><option value="monthly">شهرية</option><option value="custom">مخصصة</option></select></Field>
          <Field label="التصنيف (اختياري)"><select value={budgetForm.category_id} onChange={(e) => setBudgetForm({ ...budgetForm, category_id: e.target.value })}><option value="">كل التصنيفات</option>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="مستويات التنبيه (%)"><input required value={budgetForm.alert_thresholds} onChange={(e) => setBudgetForm({ ...budgetForm, alert_thresholds: e.target.value })} placeholder="50,75,90,100" /></Field>
          <Field label="تبدأ في"><input type="date" required value={budgetForm.starts_on} onChange={(e) => setBudgetForm({ ...budgetForm, starts_on: e.target.value })} /></Field>
          {budgetForm.period === "custom" && <Field label="تنتهي في"><input type="date" required value={budgetForm.ends_on} onChange={(e) => setBudgetForm({ ...budgetForm, ends_on: e.target.value })} /></Field>}
          <ModalSubmit busy={busy}>إنشاء الميزانية</ModalSubmit>
        </form>}
        {modal === "goal" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(() => supabase.from("savings_goals").insert({ name: goalForm.name.trim(), target_minor: minorUnits(goalForm.target), target_date: goalForm.target_date || null, icon: goalForm.icon }).then(assertResult), "تم إنشاء هدف الادخار."); }}>
          <Field label="اسم الهدف"><input required maxLength="100" value={goalForm.name} onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })} placeholder="مثال: صندوق الطوارئ" /></Field>
          <Field label="المبلغ المستهدف"><input type="number" step="0.01" min="0.01" required value={goalForm.target} onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })} /></Field>
          <Field label="التاريخ المستهدف (اختياري)"><input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} /></Field>
          <ModalSubmit busy={busy}>إضافة الهدف</ModalSubmit>
        </form>}
        {modal === "category" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(() => supabase.from("categories").insert({ name: categoryForm.name.trim(), kind: categoryForm.kind, color: categoryForm.color }).then(assertResult), "تمت إضافة التصنيف."); }}>
          <Field label="اسم التصنيف"><input required minLength="1" maxLength="60" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} /></Field>
          <Field label="نوع التصنيف"><select value={categoryForm.kind} onChange={(e) => setCategoryForm({ ...categoryForm, kind: e.target.value })}><option value="expense">مصروف</option><option value="income">دخل</option></select></Field>
          <Field label="اللون"><input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })} /></Field>
          <ModalSubmit busy={busy}>إضافة التصنيف</ModalSubmit>
        </form>}
        {modal === "contribution" && <form className="modal-form" onSubmit={(event) => { event.preventDefault(); run(() => supabase.rpc("contribute_to_savings_goal", { p_goal_id: contributionForm.goal_id, p_from_account: contributionForm.from_account, p_amount_minor: minorUnits(contributionForm.amount), p_transfer_date: today(), p_idempotency_key: contributionForm.idempotency_key }).then(assertResult), "تم تحويل المبلغ وتحديث تقدم الهدف."); }}>
          <p className="modal-hint">سيتم تحويل المبلغ من الحساب المحدد إلى حساب الادخار وإضافته للهدف بعملية ذرّية واحدة. يجب إعداد حساب الادخار من الإعدادات.</p>
          <Field label="من حساب"><select required value={contributionForm.from_account} onChange={(e) => setContributionForm({ ...contributionForm, from_account: e.target.value })}><option value="">اختر حساباً</option>{data.accounts.filter((account) => !account.is_archived && account.account_id !== data.salary?.savings_account_id).map((account) => <option key={account.account_id} value={account.account_id}>{account.name}</option>)}</select></Field>
          <Field label="مبلغ الإضافة"><input type="number" min="0.01" step="0.01" required value={contributionForm.amount} onChange={(e) => setContributionForm({ ...contributionForm, amount: e.target.value })} /></Field>
          <ModalSubmit busy={busy}>تحويل للهدف</ModalSubmit>
        </form>}
      </Modal>}
    </div>
  );
}

function Dashboard({ data, totals, totalBalance, remaining, currency, periodTransactions, setActive }) {
  const cards = [
    ["إجمالي الأرصدة", totalBalance, Wallet, "balance"],
    ["إجمالي الدخل", totals.income, ArrowDownLeft, "income"],
    ["إجمالي المصروفات", totals.expense, ArrowUpRight, "expense"],
    ["إجمالي المدخرات", totals.saved, Target, "saved"],
  ];
  const expense = totals.expense;
  const saved = totals.saved;
  const left = totals.income > expense + saved ? totals.income - expense - saved : 0n;
  const total = expense + saved + left;
  const shares = calculateDistribution(expense, saved, left);
  const maxAmount = totals.income > totals.expense ? (totals.income > 0n ? totals.income : 1n) : (totals.expense > 0n ? totals.expense : 1n);
  const lastTransactions = data.transactions.slice(0, 5);
  const hasTransactions = data.transactions.length > 0;
  return <>
    <div className="welcome-row"><div><h1>مرحباً {data.profile?.full_name || "بك"} <span className="welcome-sparkle">✦</span></h1><p>إليك لمحة عن وضعك المالي.</p></div><div className="period-pill"><span /> آخر 30 يوماً <ChevronDown size={15} /></div></div>
    {!hasTransactions && <div className="empty-banner"><div className="empty-icon"><Wallet size={23} /></div><div><b>ابدأ رحلتك المالية من هنا</b><p>لا توجد معاملات بعد. أضف أول معاملة لعرض ملخصك المالي.</p></div><button className="primary-button" onClick={() => setActive("transactions")}><Plus size={16} /> إضافة معاملة</button></div>}
    <div className="summary-grid">{cards.map(([label, amount, Icon, key]) => <div key={label} className={`summary-card ${key}`}><div className="summary-card-top"><span>{label}</span><Icon size={19} /></div><strong>{money(amount, currency)}</strong><small>{key === "balance" ? `${data.accounts.length} حساب` : "آخر 30 يوماً"}</small></div>)}</div>
    <div className="dashboard-grid">
      <section className="panel trend-panel"><div className="panel-heading"><div><h3>الدخل مقابل المصروفات</h3><span>ملخص الفترة الحالية</span></div><select aria-label="الفترة"><option>آخر 30 يوماً</option></select></div>
        <div className="compare-values"><div><i className="dot income-dot" />الدخل <b>{money(totals.income, currency)}</b></div><div><i className="dot expense-dot" />المصروفات <b>{money(totals.expense, currency)}</b></div></div>
        {hasTransactions ? <div className="bar-chart"><div className="chart-y-labels"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0</span></div><div className="chart-plot"><div className="chart-grid-lines"><i /><i /><i /><i /><i /></div><div className="bar-columns">{Array.from({ length: 6 }, (_, index) => {
          const end = new Date(); end.setDate(end.getDate() - (5 - index) * 5);
          const date = end.toISOString().slice(0, 10);
          const start = new Date(end); start.setDate(start.getDate() - 4);
          const bucket = periodTransactions.filter((t) => t.transaction_date >= start.toISOString().slice(0, 10) && t.transaction_date <= date);
          const income = sumTransactions(bucket, (t) => t.kind === "income");
          const out = sumTransactions(bucket, (t) => t.kind === "expense");
          const incomeHeight = Number(income * 1000n / maxAmount) / 10;
          const expenseHeight = Number(out * 1000n / maxAmount) / 10;
          return <div className="bar-group" key={index}><div className="bar-pair"><i className="bar income-bar" style={{ height: `${Math.max(3, incomeHeight)}%` }} /><i className="bar expense-bar" style={{ height: `${Math.max(3, expenseHeight)}%` }} /></div><span>{new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(end)}</span></div>;
        })}</div></div></div> : <EmptyState text="أضف معاملاتك لعرض الرسم البياني." />}
      </section>
      <section className="panel savings-panel"><div className="panel-heading"><div><h3>توزيع أموالك</h3><span>حسب معاملات آخر 30 يوماً</span></div><CircleHelp size={17} /></div>
        <div className="donut-wrap"><div className="donut" style={{ "--expense": `${shares[0]}%`, "--saved": `${shares[1]}%` }}><div><b>{money(totals.income, currency)}</b><span>إجمالي الدخل</span></div></div></div>
        <div className="legend-list"><Legend color="#ff875c" title="المصروفات" value={shares[0]} amount={expense} currency={currency} /><Legend color="#42d6a0" title="المدخرات" value={shares[1]} amount={saved} currency={currency} /><Legend color="#568eff" title="المتبقي" value={shares[2]} amount={left} currency={currency} /></div>
      </section>
      <section className="panel recent-panel"><div className="panel-heading"><div><h3>أحدث المعاملات</h3><span>آخر نشاط مالي</span></div><button className="quiet-button" onClick={() => setActive("transactions")}>عرض الكل <ArrowLeft size={15} /></button></div>
        {lastTransactions.length ? <div className="recent-list">{lastTransactions.map((transaction) => <TransactionRow key={transaction.id} item={transaction} data={data} currency={currency} />)}</div> : <EmptyState text="لا توجد معاملات حتى الآن." />}
      </section>
      <section className="panel goals-panel"><div className="panel-heading"><div><h3>أهدافك المالية</h3><span>خطوات صغيرة نحو أهداف كبيرة</span></div><button className="quiet-button" onClick={() => setActive("goals")}>عرض الكل <ArrowLeft size={15} /></button></div>
        {data.goals.slice(0, 3).length ? data.goals.slice(0, 3).map((goal) => <GoalProgress key={goal.id} goal={goal} currency={currency} />) : <EmptyState text="أضف هدف ادخار لتتابع تقدمك." />}
        <div className="remaining-callout"><span>المتبقي بعد المصروفات</span><strong className={remaining < 0 ? "negative" : ""}>{money(remaining, currency)}</strong></div>
      </section>
    </div>
  </>;
}

function TransactionsPage({ data, transactions, currency, query, setQuery, onAdd, onAddCategory, onEdit, onDelete }) {
  const [kind, setKind] = useState("all");
  const filtered = transactions.filter((item) => kind === "all" || item.kind === kind);
  return <section className="page-section"><div className="section-title-row"><div><h1>المعاملات</h1><p>سجل دخلك ومصروفاتك وتابع تفاصيلها.</p></div><div className="button-pair"><button className="secondary-button" onClick={onAddCategory}>تصنيف جديد</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> معاملة جديدة</button></div></div>
    <div className="panel table-panel"><div className="table-toolbar"><div className="search-field"><Search size={16} /><input placeholder="ابحث في المعاملات..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">كل الأنواع</option><option value="expense">مصروف</option><option value="income">دخل</option><option value="savings_deposit">إيداع ادخار</option><option value="savings_withdrawal">سحب ادخار</option></select></div>
      {filtered.length ? <div className="responsive-table"><table><thead><tr><th>التفاصيل</th><th>التصنيف</th><th>الحساب</th><th>التاريخ</th><th>المبلغ</th><th /></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><b>{item.description || kindLabel(item.kind)}</b><small>{item.notes}</small></td><td>{data.categories.find((c) => c.id === item.category_id)?.name || "—"}</td><td>{data.accounts.find((a) => a.account_id === item.account_id)?.name || "—"}</td><td>{item.transaction_date}</td><td className={item.kind === "income" || item.kind === "savings_deposit" ? "positive" : item.kind === "transfer" ? "" : "negative"}>{item.kind === "income" ? "+" : item.kind === "expense" || item.kind === "savings_withdrawal" ? "−" : ""}{money(item.amount_minor, currency)}</td><td>{item.kind !== "transfer" && !data.cycles.some((cycle) => cycle.income_transaction_id === item.id) && <><button className="icon-button" onClick={() => onEdit(item)} aria-label="تعديل"><Settings size={15} /></button><button className="icon-button danger-icon" onClick={() => onDelete(item)} aria-label="حذف"><Trash2 size={15} /></button></>}</td></tr>)}</tbody></table></div> : <EmptyState text={query ? "لا توجد معاملات تطابق البحث." : "لا توجد معاملات في هذا القسم بعد."} />}</div>
  </section>;
}

function AccountsPage({ data, currency, onAdd, onEdit, onTransfer, onArchive }) {
  const accounts = data.accounts.filter((account) => !account.is_archived);
  return <section className="page-section"><div className="section-title-row"><div><h1>الحسابات والمحافظ</h1><p>تابع أرصدة حساباتك وسجل التحويلات الداخلية.</p></div><div className="button-pair"><button className="secondary-button" onClick={onTransfer}><ArrowLeftRight size={16} /> تحويل</button><button className="primary-button" onClick={onAdd}><Plus size={17} /> إضافة حساب</button></div></div>
    {accounts.length ? <div className="accounts-grid">{accounts.map((account) => <article className="panel account-card" key={account.account_id}><div className="account-card-head"><span className="account-icon" style={{ color: account.color, background: `${account.color}19` }}><Wallet size={20} /></span><button className="quiet-button" onClick={() => onEdit(account)}>تعديل</button></div><span className="account-label">{account.name}</span><strong>{money(account.balance_minor, currency)}</strong><div className="account-card-footer"><span>رصيد الحساب</span><button className="text-danger" onClick={() => onArchive(account)}>أرشفة</button></div></article>)}</div> : <EmptyState text="أضف حسابك الأول لبدء تتبع أرصدتك." />}
  </section>;
}

function BudgetsPage({ data, currency, onAdd, onDelete }) {
  return <section className="page-section"><div className="section-title-row"><div><h1>الميزانيات</h1><p>حدد حدود الإنفاق وراقب استخدام كل ميزانية.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> ميزانية جديدة</button></div>
    {data.budgets.length ? <div className="budget-grid">{data.budgets.map((budget) => {
      const links = data.budgetCategories.filter((link) => link.budget_id === budget.id);
      const range = budgetRange(budget);
      const spent = range ? sumTransactions(data.transactions.filter((t) => t.kind === "expense" && t.transaction_date >= range.start && t.transaction_date <= range.end && (!links.length || links.some((link) => link.category_id === t.category_id))), () => true) : 0n;
      const usage = calculateBudgetUsage(spent, budget.amount_minor);
      const percent = usage.percent;
      const status = percent >= 100 ? "danger" : percent >= 75 ? "warning" : "okay";
      return <article className="panel budget-card" key={budget.id}><div className="panel-heading"><div><h3>{budget.name}</h3><span>{budget.period === "weekly" ? "أسبوعية" : budget.period === "custom" ? `${budget.starts_on} — ${budget.ends_on}` : "شهرية"}</span></div><button className="icon-button danger-icon" onClick={() => onDelete(budget)} aria-label="حذف"><Trash2 size={16} /></button></div><div className="budget-amounts"><strong>{money(spent, currency)}</strong><span>من {money(budget.amount_minor, currency)}</span></div><div className={`progress-track ${status}`}><i style={{ width: `${percent}%` }} /></div><div className="budget-footer"><span>{percent}% مستخدم</span><span className={status}>{money(usage.remainingMinor, currency)} متبقي</span></div>{percent >= 90 && <div className="budget-alert">اقتربت من الحد المحدد لهذه الميزانية.</div>}</article>;
    })}</div> : <EmptyState text="لم تنشئ ميزانية بعد. حدد ميزانية لتتابع مصروفاتك." />}
  </section>;
}

function GoalsPage({ data, currency, onAdd, onContribute, onDelete }) {
  return <section className="page-section"><div className="section-title-row"><div><h1>أهداف الادخار</h1><p>حوّل خططك المالية إلى أهداف قابلة للمتابعة.</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} /> هدف جديد</button></div>
    {data.goals.length ? <div className="goals-grid">{data.goals.map((goal) => <article className="panel goal-card" key={goal.id}><div className="goal-card-top"><span className="goal-icon"><Target size={21} /></span><button className="icon-button danger-icon" onClick={() => onDelete(goal)} aria-label="حذف"><Trash2 size={16} /></button></div><h3>{goal.name}</h3><GoalProgress goal={goal} currency={currency} /><div className="goal-date">{goal.target_date ? `التاريخ المستهدف: ${goal.target_date}` : "لم يحدد تاريخ مستهدف"}    {goal.target_date && <small>{monthlyNeeded(goal, currency)} شهرياً للوصول للهدف</small>}</div><button className="secondary-button full-button" onClick={() => onContribute(goal)}><Plus size={16} /> إضافة مبلغ مُدخر</button></article>)}</div> : <EmptyState text="أضف أول هدف ادخار وحدد المبلغ الذي تطمح إليه." />}
  </section>;
}
function monthlyNeeded(goal, currency) {
  if (!goal.target_date) return "—";
  const months = BigInt(Math.max(1, (new Date(goal.target_date).getFullYear() - new Date().getFullYear()) * 12 + new Date(goal.target_date).getMonth() - new Date().getMonth()));
  const remaining = BigInt(goal.target_minor) > BigInt(goal.saved_minor) ? BigInt(goal.target_minor) - BigInt(goal.saved_minor) : 0n;
  return money((remaining + months - 1n) / months, currency);
}

function ReportsPage({ data, currency, start, end, period, setPeriod, onExport }) {
  const rows = data.transactions.filter((item) => item.transaction_date >= start && item.transaction_date <= end);
  const income = sumTransactions(rows, (item) => item.kind === "income");
  const expenses = sumTransactions(rows, (item) => item.kind === "expense");
  const saved = sumTransactions(rows, (item) => item.kind === "savings_deposit" || (
    item.kind === "transfer" && item.account_id === data.salary?.savings_account_id &&
    item.description.startsWith("[تحويل وارد]")
  ));
  const categories = data.categories.filter((c) => c.kind === "expense").map((category) => ({ ...category, amount: sumTransactions(rows, (t) => t.category_id === category.id && t.kind === "expense") })).filter((category) => category.amount > 0n).sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0);
  return <section className="page-section"><div className="section-title-row"><div><h1>التقارير والتحليلات</h1><p>ملخص حقيقي لحركة أموالك خلال الفترة المحددة.</p></div><button className="secondary-button" onClick={onExport}><Download size={16} /> تصدير CSV</button></div>
    <div className="report-controls"><label>الفترة <select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="month">الشهر الحالي</option><option value="previous">الشهر السابق</option><option value="30days">آخر 30 يوماً</option></select></label><span>من {start} إلى {end}</span></div>
    <div className="summary-grid report-summary"><Summary label="الدخل" value={income} currency={currency} /><Summary label="المصروفات" value={expenses} currency={currency} /><Summary label="الادخار" value={saved} currency={currency} /><Summary label="صافي التدفق" value={income - expenses - saved} currency={currency} /></div>
    <section className="panel report-category"><div className="panel-heading"><div><h3>المصروفات حسب التصنيف</h3><span>مصروفات مسجلة فقط</span></div></div>
      {categories.length ? categories.map((category) => <div className="category-report-row" key={category.id}><span className="category-dot" style={{ background: category.color }} /> <span>{category.name}</span><div className="category-report-track"><i style={{ width: `${Math.max(3, Number(category.amount * 1000n / expenses) / 10)}%`, background: category.color }} /></div><b>{money(category.amount, currency)}</b></div>) : <EmptyState text="لا توجد مصروفات مسجلة ضمن الفترة." />}
    </section>
  </section>;
}

function SettingsPage({ data, profileForm, setProfileForm, salaryForm, setSalaryForm, onSaveProfile, onChangePassword, onSaveSalary, onStartCycle, onReset, onExport }) {
  const [cycle, setCycle] = useState({ starts_on: today(), ends_on: today(), income: "", income_account_id: data.accounts[0]?.account_id || "" });
  const endCycle = () => { const end = new Date(`${cycle.starts_on}T00:00:00`); end.setDate(end.getDate() + Number(salaryForm.cycle_days || 30) - 1); setCycle({ ...cycle, ends_on: end.toISOString().slice(0, 10) }); };
  return <section className="page-section"><div className="section-title-row"><div><h1>الإعدادات</h1><p>تحكم في معلومات الحساب والعملة ودورات راتبك.</p></div></div>
    <div className="settings-grid"><section className="panel settings-card"><div className="panel-heading"><div><h3>الحساب والتفضيلات</h3><span>الاسم والعملة والمظهر</span></div><ShieldCheck size={18} /></div>
      <Field label="الاسم الشخصي"><input value={profileForm.full_name} maxLength="80" onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })} /></Field>
      <Field label="العملة"><select value={profileForm.currency} onChange={(e) => setProfileForm({ ...profileForm, currency: e.target.value })}><option value="EGP">الجنيه المصري (EGP)</option><option value="USD">الدولار الأمريكي (USD)</option><option value="SAR">الريال السعودي (SAR)</option><option value="AED">الدرهم الإماراتي (AED)</option></select></Field>
      <Field label="المظهر"><select value={profileForm.theme} onChange={(e) => setProfileForm({ ...profileForm, theme: e.target.value })}><option value="dark">داكن</option><option value="light">فاتح</option></select></Field>
      <button className="primary-button" onClick={onSaveProfile}>حفظ الإعدادات</button>
      <button className="secondary-button" onClick={onChangePassword}>إرسال رابط تغيير كلمة المرور</button>
    </section>
    <section className="panel settings-card"><div className="panel-heading"><div><h3>إعدادات الراتب والادخار</h3><span>تفعيل دورة راتب وتحويل الفائض لحسابك</span></div></div>
      <label className="toggle-row"><span>تفعيل نظام الراتب</span><input type="checkbox" checked={salaryForm.enabled} onChange={(e) => setSalaryForm({ ...salaryForm, enabled: e.target.checked })} /></label>
      <Field label="قيمة الراتب"><input type="number" min="0" step="0.01" value={salaryForm.salary} onChange={(e) => setSalaryForm({ ...salaryForm, salary: e.target.value })} /></Field>
      <Field label="يوم استلام الراتب (اختياري)"><input type="number" min="1" max="31" value={salaryForm.pay_day} onChange={(e) => setSalaryForm({ ...salaryForm, pay_day: e.target.value })} /></Field>
      <Field label="طول الدورة بالأيام"><input type="number" min="1" max="366" value={salaryForm.cycle_days} onChange={(e) => setSalaryForm({ ...salaryForm, cycle_days: e.target.value })} /></Field>
      <label className="toggle-row"><span>تحويل الفائض تلقائياً عند إغلاق الدورة</span><input type="checkbox" checked={salaryForm.auto_save_enabled} onChange={(e) => setSalaryForm({ ...salaryForm, auto_save_enabled: e.target.checked })} /></label>
      <Field label="نسبة التحويل (%)"><input type="number" min="1" max="100" value={salaryForm.auto_save_percent} onChange={(e) => setSalaryForm({ ...salaryForm, auto_save_percent: e.target.value })} /></Field>
      <Field label="حساب الادخار"><select value={salaryForm.savings_account_id} onChange={(e) => setSalaryForm({ ...salaryForm, savings_account_id: e.target.value })}><option value="">اختر حساباً</option>{data.accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.name}</option>)}</select></Field>
      <button className="primary-button" onClick={onSaveSalary}>حفظ إعدادات الراتب</button>
      <div className="cycle-form"><h4>تسجيل دورة راتب مؤكدة</h4><p className="modal-hint">تُسجّل الدورة بعد انتهائها فقط. سيضاف الدخل لحسابك ثم يحسب الادخار تلقائياً إذا كان مفعلاً.</p><div className="cycle-inputs"><Field label="بداية الدورة"><input type="date" value={cycle.starts_on} onChange={(e) => setCycle({ ...cycle, starts_on: e.target.value })} onBlur={endCycle} /></Field><Field label="نهاية الدورة"><input type="date" value={cycle.ends_on} onChange={(e) => setCycle({ ...cycle, ends_on: e.target.value })} /></Field><Field label="الدخل الفعلي"><input type="number" min="0.01" step="0.01" value={cycle.income} onChange={(e) => setCycle({ ...cycle, income: e.target.value })} /></Field></div><Field label="حساب استلام الراتب"><select value={cycle.income_account_id} onChange={(e) => setCycle({ ...cycle, income_account_id: e.target.value })}>{data.accounts.filter((account) => !account.is_archived).map((account) => <option value={account.account_id} key={account.account_id}>{account.name}</option>)}</select></Field><button className="secondary-button" onClick={() => onStartCycle(cycle)}>تسجيل الدورة وإغلاقها</button></div>
      {data.cycles.length > 0 && <div className="cycles-list"><b>الدورات السابقة</b>{data.cycles.slice(0, 4).map((item) => <div key={item.id}><span>{item.starts_on} — {item.ends_on}</span><span>{money(item.income_minor, data.preferences?.currency || "EGP")}</span></div>)}</div>}
    </section>
    <section className="panel settings-card"><div className="panel-heading"><div><h3>الخصوصية والبيانات</h3><span>يمكنك تنزيل نسخة من بيانات معاملاتك أو مسح بياناتك المالية.</span></div></div>
      <button className="secondary-button" onClick={onExport}><Download size={16} /> تصدير معاملات CSV</button>
      <div className="danger-zone"><b>إعادة تعيين البيانات المالية</b><p>تحذف المعاملات والحسابات والميزانيات والأهداف الخاصة بحسابك فقط. لا يمكن التراجع عن ذلك.</p><button className="danger-button" onClick={onReset}><Trash2 size={16} /> إعادة تعيين البيانات المالية</button></div>
    </section></div>
  </section>;
}

function NotificationsPage({ data, run }) {
  const unread = data.notifications.filter((n) => !n.read_at).length;
  return <section className="page-section"><div className="section-title-row"><div><h1>مركز الإشعارات</h1><p>{unread ? `${unread} إشعار غير مقروء` : "أنت على اطلاع بكل جديد."}</p></div>{unread > 0 && <button className="secondary-button" onClick={() => run(() => supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null).then(assertResult), "تم تحديد الإشعارات كمقروءة.")}><Check size={16} /> تحديد الكل كمقروء</button>}</div>
    <div className="panel notifications-list">{data.notifications.length ? data.notifications.map((item) => <div className={`notification-row ${item.read_at ? "" : "unread"}`} key={item.id}><span className="notification-mark"><Bell size={16} /></span><div><b>{item.title}</b><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("ar-EG")}</small></div>{!item.read_at && <button className="quiet-button" onClick={() => run(() => supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", item.id).then(assertResult), "تم تحديد الإشعار كمقروء.")}>مقروء</button>}<button className="icon-button danger-icon" onClick={() => run(() => supabase.from("notifications").delete().eq("id", item.id).then(assertResult), "تم حذف الإشعار.")} aria-label="حذف"><Trash2 size={15} /></button></div>) : <EmptyState text="لا توجد إشعارات حالياً." />}</div>
  </section>;
}

function AssistantPage({ onAsk, answer, busy }) {
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  return <section className="page-section"><div className="section-title-row"><div><h1>LUMORA AI</h1><p>مساعد اختياري لتحليل ملخص معاملاتك الفعلية.</p></div></div>
    <div className="panel ai-unavailable"><span><Sparkles size={26} /></span><h2>مساعدك المالي</h2>
      <p>يتطلب تشغيله نشر Edge Function وإعداد مفتاح Gemini. عند الإرسال، سيُشارك ملخص دخل ومصروفات آخر 30 يوماً والتصنيفات مع Google Gemini. لا نرسل أوصاف المعاملات.</p>
      <form className="ai-form" onSubmit={(event) => { event.preventDefault(); if (consent && question.trim()) onAsk(question.trim()); }}>
        <label className="field"><span>سؤالك المالي</span><textarea maxLength="500" required value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="مثال: ما أعلى تصنيف إنفاقاً خلال آخر 30 يوماً؟" /></label>
        <label className="ai-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>أوافق على إرسال الملخص المالي المذكور إلى Google Gemini للإجابة عن هذا السؤال.</span></label>
        <button className="primary-button" disabled={!consent || busy || !question.trim()}>{busy ? <span className="spinner" /> : <Sparkles size={15} />} إرسال السؤال</button>
      </form>
      {answer && <div className="ai-answer"><b>الإجابة</b><p>{answer}</p></div>}
      <div className="ai-status"><i /> لا يتم توليد إجابات محلية أو وهمية</div>
    </div>
  </section>;
}

function TransactionRow({ item, data, currency }) {
  const isIncome = item.kind === "income" || item.kind === "savings_deposit";
  return <div className="recent-row"><span className={`transaction-icon ${isIncome ? "income-icon" : "expense-icon"}`}>{isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div className="recent-description"><b>{item.description || kindLabel(item.kind)}</b><span>{data.categories.find((c) => c.id === item.category_id)?.name || kindLabel(item.kind)} · {item.transaction_date}</span></div><strong className={isIncome ? "positive" : "negative"}>{isIncome ? "+" : "−"}{money(item.amount_minor, currency)}</strong></div>;
}
function GoalProgress({ goal, currency }) {
  const percent = Math.min(100, calculateBudgetUsage(goal.saved_minor, goal.target_minor).percent);
  return <div className="goal-progress"><div className="goal-progress-label"><span>{money(goal.saved_minor, currency)} <small>من {money(goal.target_minor, currency)}</small></span><b>{percent}%</b></div><div className="progress-track"><i style={{ width: `${percent}%` }} /></div></div>;
}
function Legend({ color, title, value, amount, currency }) {
  return <div className="legend-row"><i style={{ background: color }} /><span>{title}</span><b>{value}%</b><small>{money(amount, currency)}</small></div>;
}
function Summary({ label, value, currency }) {
  return <div className="summary-card"><div className="summary-card-top"><span>{label}</span></div><strong>{money(value, currency)}</strong></div>;
}
function EmptyState({ text }) {
  return <div className="empty-state"><span className="empty-state-icon"><Wallet size={19} /></span><p>{text}</p></div>;
}
function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function Modal({ title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></div>{children}</section></div>;
}
function ModalSubmit({ busy, children }) {
  return <button className="primary-button modal-submit" disabled={busy} type="submit">{busy ? <span className="spinner" /> : children}</button>;
}
function kindLabel(kind) {
  return ({ income: "دخل", expense: "مصروف", savings_deposit: "إيداع ادخار", savings_withdrawal: "سحب ادخار", transfer: "تحويل" })[kind] || kind;
}
function modalTitle(modal) {
  return ({ transaction: "إضافة معاملة", account: "إعداد الحساب", transfer: "تحويل بين الحسابات", budget: "إنشاء ميزانية", goal: "هدف ادخار جديد" })[modal];
}
