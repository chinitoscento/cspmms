import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Check, Circle, ShieldAlert } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { PASSWORD_RULES, passwordProblem } from '../passwordRules';
import logoImage from '../logo.png';

export default function ChangePassword({ user, onDone, onSignOut }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    const problem = passwordProblem(password, user.username);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { error: flagError } = await supabase.rpc('complete_password_change');
      if (flagError) throw flagError;

      onDone();
    } catch (err) {
      setError(
        /different from the old/i.test(err.message)
          ? 'Choose a password that is different from your temporary one.'
          : err.message || 'Could not update your password.'
      );
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#0e0d0c] px-4 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(700px 420px at 50% 0%, rgba(217,178,76,0.10), transparent 70%)' }}
      />

      <div className="cs-card cs-fade relative w-full max-w-md p-8 sm:p-10 rounded-3xl shadow-2xl">
        <div className="text-center mb-7">
          <div className="w-16 h-16 mx-auto mb-3">
            <img src={logoImage} alt="Chinito Scento logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-serif text-3xl font-semibold text-[#e3bf5a]">Set your new password</h1>
          <p className="text-sm text-[#a8a090] mt-2">
            Welcome, {user.first_name}. Your temporary password was shared with you, so choose one only you know before continuing.
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-5 p-3.5 rounded-xl bg-[#f0716b]/10 border border-[#f0716b]/30 text-[#f0908b] text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="new-password" className="cs-label">New password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-[#a8a090]" aria-hidden="true" />
              <input
                id="new-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="cs-input pl-10 pr-12 py-3"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide passwords' : 'Show passwords'}
                className="absolute right-3.5 top-3.5 text-[#a8a090] hover:text-[#e3bf5a] transition-colors cursor-pointer"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="cs-label">Confirm new password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-[#a8a090]" aria-hidden="true" />
              <input
                id="confirm-password"
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="cs-input pl-10 pr-4 py-3"
              />
            </div>
          </div>

          <ul className="space-y-1.5 text-xs" aria-label="Password requirements">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.id} className={`flex items-center gap-2 ${ok ? 'text-[#3ecf8e]' : 'text-[#a8a090]'}`}>
                  {ok ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Circle className="w-3.5 h-3.5" aria-hidden="true" />}
                  <span>{rule.label}</span>
                </li>
              );
            })}
          </ul>

          <button type="submit" disabled={saving} className="cs-btn cs-btn-gold w-full justify-center py-3.5">
            {saving ? 'Saving...' : 'Save password and continue'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => onSignOut()}
          className="mt-5 w-full text-center text-xs text-[#a8a090] hover:text-[#e3bf5a] cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
