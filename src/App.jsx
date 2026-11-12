import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";
import FinanceApp from "./FinanceApp.jsx";

const screens = {
  login: { title: "مرحباً بعودتك", subtitle: "سجّل دخولك لمتابعة رحلتك المالية." },
  signup: { title: "ابدأ رحلتك المالية", subtitle: "أنشئ حسابك واكتشف طريقة أذكى لإدارة أموالك." },
  forgot: { title: "نسيت كلمة المرور؟", subtitle: "أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيينها." },
  update: { title: "اختر كلمة مرور جديدة", subtitle: "اجعلها قوية وسهلة التذكر بالنسبة إليك." },
};

function WolfMark({ small = false }) {
  return (
    <svg
      className={`wolf-mark${small ? " wolf-mark-small" : ""}`}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 9 25 17 32 12 39 17 52 9 49 29 56 39 45 38 41 54 32 47 23 54 19 38 8 39 15 29 12 9Z" />
      <path d="m22 27 8 4-5 5m17-9-8 4 5 5M32 29v11m-6 2 6 5 6-5" />
    </svg>
  );
}

function App() {
  const [screen, setScreen] = useState(() =>
    new URLSearchParams(window.location.search).get("mode") === "update-password"
      ? "update"
      : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setNotice({ type: "error", text: friendlyError(error.message) });
        return;
      }
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === "PASSWORD_RECOVERY" && session) {
        setHasRecoverySession(true);
        setScreen("update");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const navigate = (nextScreen) => {
    setNotice(null);
    setPassword("");
    setScreen(nextScreen);
    if (nextScreen === "update") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "update-password");
      window.history.replaceState({}, "", url);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("mode");
      window.history.replaceState({}, "", url);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setNotice(null);

    if (!isSupabaseConfigured) {
      setNotice({
        type: "error",
        text: "أضف رابط Supabase ومفتاح anon إلى config.js لتفعيل هذه الخدمة.",
      });
      return;
    }

    if (screen === "update" && !hasRecoverySession) {
      setNotice({
        type: "error",
        text: "افتح رابط إعادة التعيين الذي وصلك عبر البريد الإلكتروني أولاً.",
      });
      return;
    }

    setBusy(true);
    try {
      let result;
      if (screen === "signup") {
        result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (!result.error) {
          setNotice({
            type: "success",
            text: result.data.session
              ? "تم إنشاء حسابك بنجاح. يمكنك الآن تسجيل الدخول."
              : "تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيده.",
          });
          setScreen("login");
          setPassword("");
        }
      } else if (screen === "login") {
        result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (!result.error) {
          setNotice({ type: "success", text: "تم تسجيل الدخول بنجاح." });
        }
      } else if (screen === "forgot") {
        result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: new URL(
            "?mode=update-password",
            new URL(import.meta.env.BASE_URL, window.location.href),
          ).toString(),
        });
        if (!result.error) {
          setNotice({ type: "success", text: "إذا كان البريد مسجلاً، سيصلك رابط إعادة التعيين قريباً." });
        }
      } else {
        result = await supabase.auth.updateUser({ password });
        if (!result.error) {
          setNotice({ type: "success", text: "تم تحديث كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول." });
          setHasRecoverySession(false);
          await supabase.auth.signOut();
          navigate("login");
          setNotice({ type: "success", text: "تم تحديث كلمة المرور بنجاح. سجّل الدخول بكلمتك الجديدة." });
        }
      }

      if (result?.error) {
        setNotice({ type: "error", text: friendlyError(result.error.message) });
      }
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error.message) });
    } finally {
      setBusy(false);
    }
  };

  const isPasswordScreen = screen !== "forgot";
  const copy = screens[screen];

  if (session) {
    return <FinanceApp session={session} onSignedOut={() => setSession(null)} />;
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="LUMORA الرئيسية">
          <WolfMark small />
          <span>LUMORA</span>
        </a>
        <div className="secure-label"><ShieldCheck size={15} /> مساحة آمنة وخاصة</div>
      </header>

      <section className="auth-layout">
        <aside className="story-panel" aria-label="عن LUMORA">
          <div className="story-content">
            <div className="eyebrow"><Sparkles size={15} /> SMART FINANCIAL LIFE</div>
            <h1>مستقبلك المالي،<br /><span>بين يديك.</span></h1>
            <p className="story-copy">
              نظرة أوضح على أموالك اليوم، وخطوات أذكى نحو أهدافك غداً.
            </p>
            <div className="insight-card">
              <div className="insight-icon"><WalletCards size={21} /></div>
              <div>
                <span className="insight-caption">خطوة صغيرة، فرق كبير</span>
                <strong>ابدأ بإدارة أموالك بوعي</strong>
              </div>
              <ArrowLeft className="insight-arrow" size={18} />
            </div>
          </div>
          <div className="story-footer">
            <WolfMark />
            <span>وضوح أكثر <i /> تحكم أفضل <i /> مستقبل أذكى</span>
          </div>
        </aside>

        <section className="form-panel">
          <div className="mobile-brand"><WolfMark small /><span>LUMORA</span></div>
          <div className="form-heading">
            <div className="form-kicker">{screen === "signup" ? "حساب جديد" : screen === "login" ? "مساحتك المالية" : "استعادة الوصول"}</div>
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </div>

          <form onSubmit={submit} className="auth-form">
            {screen === "signup" && (
              <label className="field">
                <span>الاسم الكامل</span>
                <div className="input-wrap">
                  <input
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="مثال: أحمد محمد"
                    required
                    minLength={2}
                  />
                </div>
              </label>
            )}

            {screen !== "update" && (
              <label className="field">
                <span>البريد الإلكتروني</span>
                <div className="input-wrap">
                  <Mail size={18} />
                  <input
                    type="email"
                    autoComplete="email"
                    dir="ltr"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    required
                  />
                </div>
              </label>
            )}

            {isPasswordScreen && (
              <label className="field">
                <span id="password-label">{screen === "update" ? "كلمة المرور الجديدة" : "كلمة المرور"}</span>
                <div className="input-wrap">
                  <LockKeyhole size={18} />
                  <input
                    aria-labelledby="password-label"
                    type={showPassword ? "text" : "password"}
                    autoComplete={screen === "signup" ? "new-password" : screen === "update" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    minLength={8}
                    required
                  />
                  <button
                    className="visibility-button"
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {screen !== "login" && screen !== "forgot" && (
                  <small className="field-hint">يجب ألا تقل كلمة المرور عن 8 أحرف.</small>
                )}
              </label>
            )}

            {screen === "login" && (
              <button className="text-link forgot-link" type="button" onClick={() => navigate("forgot")}>
                نسيت كلمة المرور؟
              </button>
            )}

            {notice && (
              <div className={`notice ${notice.type}`} role="status">
                {notice.type === "success" && <Check size={17} />}
                <span>{notice.text}</span>
              </div>
            )}

            {!isSupabaseConfigured && (
              <div className="setup-note">
                <span className="setup-dot" />
                <span>أضف بيانات مشروع Supabase في <code>config.js</code> لتفعيل الحسابات.</span>
              </div>
            )}

            <button className="submit-button" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : <>{buttonText(screen)} <ArrowLeft size={18} /></>}
            </button>
          </form>

          <div className="form-switch">
            {screen === "login" ? (
              <>ليس لديك حساب؟ <button className="text-link" type="button" onClick={() => navigate("signup")}>أنشئ حساباً جديداً</button></>
            ) : screen === "signup" ? (
              <>لديك حساب بالفعل؟ <button className="text-link" type="button" onClick={() => navigate("login")}>سجّل الدخول</button></>
            ) : (
              <button className="back-link" type="button" onClick={() => navigate("login")}><ArrowRight size={16} /> العودة لتسجيل الدخول</button>
            )}
          </div>
          <div className="terms">بمتابعة استخدام LUMORA، أنت توافق على شروط الاستخدام وسياسة الخصوصية.</div>
        </section>
      </section>
      <footer className="page-footer"><span>© {new Date().getFullYear()} LUMORA</span><span>أموالك بذكاء، لحياة أفضل</span></footer>
    </main>
  );
}

function buttonText(screen) {
  if (screen === "login") return "تسجيل الدخول";
  if (screen === "signup") return "إنشاء الحساب";
  if (screen === "forgot") return "إرسال رابط الاستعادة";
  return "تحديث كلمة المرور";
}

function friendlyError(message = "") {
  if (/invalid login credentials/i.test(message)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  if (/email not confirmed/i.test(message)) return "يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.";
  if (/user already registered/i.test(message)) return "هذا البريد مسجل بالفعل. جرّب تسجيل الدخول.";
  if (/password should be at least/i.test(message)) return "كلمة المرور يجب ألا تقل عن 8 أحرف.";
  if (/rate limit/i.test(message)) return "تم إرسال طلبات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.";
  return "تعذر إكمال الطلب. تحقق من البيانات وحاول مرة أخرى.";
}

export default App;
