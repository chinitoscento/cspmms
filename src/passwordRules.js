export const PASSWORD_RULES = [
  { id: 'len', label: 'At least 10 characters', test: (pw) => pw.length >= 10 },
  { id: 'upper', label: 'One uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { id: 'lower', label: 'One lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { id: 'num', label: 'One number', test: (pw) => /\d/.test(pw) },
];

// Returns an error message, or '' when the password is acceptable.
export function passwordProblem(pw, username = '') {
  const failed = PASSWORD_RULES.find((r) => !r.test(pw));
  if (failed) return `Password needs: ${failed.label.toLowerCase()}.`;
  if (username && pw.toLowerCase().includes(username.toLowerCase())) {
    return 'Password must not contain the username.';
  }
  return '';
}

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

// Random temporary password without look-alike characters (0/O, 1/l/I)
export function generateTempPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set) => set[rand(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}