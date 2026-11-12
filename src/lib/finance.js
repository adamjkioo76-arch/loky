export function toMinorUnits(value) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match || match[1].length > 14) {
    throw new Error("أدخل مبلغاً صحيحاً أكبر من صفر.");
  }
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("أدخل مبلغاً صحيحاً أكبر من صفر.");
  }
  return minor.toString();
}

export function sumMinor(values) {
  return values.reduce((total, value) => total + BigInt(value || 0), 0n);
}

export function sumTransactions(transactions, predicate) {
  return sumMinor(transactions.filter(predicate).map((transaction) => transaction.amount_minor));
}

export function calculateBudgetUsage(spentMinor, limitMinor) {
  const spent = BigInt(spentMinor);
  const limit = BigInt(limitMinor);
  if (limit <= 0n) throw new Error("يجب أن يكون حد الميزانية أكبر من صفر.");
  return {
    spentMinor: spent,
    remainingMinor: spent >= limit ? 0n : limit - spent,
    percent: Number((spent * 100n) / limit),
  };
}

export function calculateSavingsSurplus(incomeMinor, expensesMinor, priorSavingsMinor, percentage = 100) {
  const income = BigInt(incomeMinor);
  const expenses = BigInt(expensesMinor);
  const savings = BigInt(priorSavingsMinor);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("نسبة الادخار يجب أن تكون بين 0 و100.");
  }
  const surplus = income > expenses + savings ? income - expenses - savings : 0n;
  return (surplus * BigInt(percentage)) / 100n;
}

export function calculateDistribution(expenseMinor, savingsMinor, remainingMinor) {
  const amounts = [BigInt(expenseMinor), BigInt(savingsMinor), BigInt(remainingMinor)];
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (total <= 0n) return [0, 0, 0];
  const shares = amounts.map((amount) => Number((amount * 100n) / total));
  const remainders = amounts.map((amount) => (amount * 100n) % total);
  let remainder = 100 - shares.reduce((sum, value) => sum + value, 0);
  const priority = [0, 1, 2].sort((a, b) => remainders[a] > remainders[b] ? -1 : remainders[a] < remainders[b] ? 1 : a - b);
  for (let index = 0; index < remainder; index += 1) shares[priority[index]] += 1;
  return shares;
}
