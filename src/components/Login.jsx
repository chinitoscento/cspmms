import React, { useState } from 'react';
import { User, Lock, ArrowRight, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../supabaseClient';
import logoImage from '../logo.png';

export default function Login({ onSignedIn, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const GENERIC_ERROR = 'Invalid username or password.';
  const REVOKED_MESSAGE = 'Your user credential has been revoked. Please contact the management.';
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 1. Turn the username into the email that Supabase Auth signs in with
      const { data: email, error: lookupError } = await supabase.rpc('login_email_for', {
        p_username: username.trim(),
      });
      if (lookupError) throw lookupError;
      if (!email) {
        setError(GENERIC_ERROR);
        setLoading(false);
        return;
      }

      // 2. Supabase checks the password against its hashed copy
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        
        setError(
            signInError.code === 'user_banned' || /banned/i.test(signInError.message)
            ? REVOKED_MESSAGE
            : GENERIC_ERROR
        );
        setLoading(false);
        return;
      }

      

      // 3. App loads the profile and checks status
      const { problem } = await onSignedIn(data.user.id);
      if (problem) {
        setError(problem);
        setLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Sign in failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#0e0d0c] px-4 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(700px 420px at 50% 0%, rgba(217,178,76,0.10), transparent 70%)' }}
      />

      <div className="cs-card cs-fade relative w-full max-w-md p-8 sm:p-10 rounded-3xl shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4">
            <img src={logoImage} alt="Chinito Scento logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="font-serif text-3xl font-semibold tracking-[0.14em] text-[#e3bf5a]">CHINITO SCENTO</h1>
          <p className="text-xs text-[#a8a090] mt-1.5">Perfumery Manufacturing &amp; Management System</p>
        </div>

        {notice && !error && (
          <div role="status" className="mb-6 p-3.5 rounded-xl bg-[#e5a93d]/10 border border-[#e5a93d]/30 text-[#e5a93d] text-xs">
            {notice}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-6 p-3.5 rounded-xl bg-[#f0716b]/10 border border-[#f0716b]/30 text-[#f0908b] text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="login-username" className="cs-label">Username</label>
            <div className="relative">
              <User className="absolute left-3.5 top-3.5 w-4 h-4 text-[#a8a090]" aria-hidden="true" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                className="cs-input pl-10 pr-4 py-3"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="cs-label">Password</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-[#a8a090]" aria-hidden="true" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="cs-input pl-10 pr-12 py-3"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3.5 top-3.5 text-[#a8a090] hover:text-[#e3bf5a] transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="cs-btn cs-btn-gold w-full justify-center py-3.5">
            <span>{loading ? 'Signing in...' : 'Access System'}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>

        <p className="mt-8 pt-6 border-t border-[#2a2622] text-center text-[11px] text-[#a8a090]">
          Restricted enterprise access. Forgot your password? Ask the owner to reset it.
        </p>
      </div>
    </div>
  );
}
