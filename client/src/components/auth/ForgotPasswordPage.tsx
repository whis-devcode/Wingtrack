import { useState, useEffect, useRef } from 'react'
import { useAuth, type PasswordResetOutcome } from '@/hooks/useAuth'
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@/lib/validation'
import AuthShell from './AuthShell'

interface ForgotPasswordPageProps {
  onBack: () => void
  onSignInWithOtp?: (email: string) => void
}

type ForgotStep = 'email' | 'otp' | 'new-password' | 'done'

const OTP_EXPIRY_SECONDS = 300

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ color: met ? '#15803d' : '#9ca3af', fontSize: 14, lineHeight: 1 }}>
        {met ? '✓' : '○'}
      </span>
      <span style={{ color: met ? '#15803d' : 'var(--muted-foreground)', fontWeight: met ? 600 : 400 }}>
        {label}
      </span>
    </div>
  )
}

const EyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

const Eye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

export default function ForgotPasswordPage({ onBack, onSignInWithOtp }: ForgotPasswordPageProps) {
  const { sendPasswordReset, verifyPasswordResetOtp, updatePassword, signOut } = useAuth()

  const [step, setStep] = useState<ForgotStep>('email')
  const [email, setEmail] = useState('')
  const [outcome, setOutcome] = useState<PasswordResetOutcome | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 2: 6-digit OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [expiry, setExpiry] = useState(OTP_EXPIRY_SECONDS)
  const [expired, setExpired] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [info, setInfo] = useState<string | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Step 3: New password state
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const rules = checkPasswordStrength(password)
  const reqs = {
    length: rules[0].met,
    uppercase: rules[1].met,
    number: rules[2].met,
    special: rules[3].met,
  }
  const allReqsMet = reqs.length && reqs.uppercase && reqs.number && reqs.special
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0
  const allOtpFilled = otpDigits.every(d => d !== '')

  // Expiry countdown while waiting for OTP
  useEffect(() => {
    if (step !== 'otp' || expired) return
    if (expiry <= 0) { setExpired(true); return }
    const t = setTimeout(() => setExpiry(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [step, expiry, expired])

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Clear any active recovery session if the user cancels out before saving.
  async function handleSafeBack() {
    if (step === 'new-password') {
      await signOut().catch(() => undefined)
    }
    onBack()
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    const target = email.trim()
    if (!target) return
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const res = await sendPasswordReset(target)
      setOutcome(res)
      setOtpDigits(['', '', '', '', '', ''])
      setExpiry(OTP_EXPIRY_SECONDS)
      setExpired(false)
      setResendCooldown(60)
      setStep('otp')
      setTimeout(() => otpRefs.current[0]?.focus(), 50)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || loading) return
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      const res = await sendPasswordReset(email.trim())
      setOutcome(res)
      setOtpDigits(['', '', '', '', '', ''])
      setExpiry(OTP_EXPIRY_SECONDS)
      setExpired(false)
      setResendCooldown(60)
      setInfo(`A new 6-digit code was sent to ${email.trim().toLowerCase()}.`)
      setTimeout(() => otpRefs.current[0]?.focus(), 50)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not resend reset code.')
    } finally {
      setLoading(false)
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (expired) return
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otpDigits]
    next[index] = digit
    setOtpDigits(next)
    setError(null)
    if (digit && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (otpDigits[index]) {
        const next = [...otpDigits]; next[index] = ''; setOtpDigits(next)
      } else if (index > 0) {
        otpRefs.current[index - 1]?.focus()
        const next = [...otpDigits]; next[index - 1] = ''; setOtpDigits(next)
      }
    } else if (e.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus()
    else if (e.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault()
    if (expired) return
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    const next = [...otpDigits]
    for (let i = 0; i < text.length; i++) next[i] = text[i]
    setOtpDigits(next)
    setError(null)
    otpRefs.current[Math.min(text.length, 5)]?.focus()
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (expired) {
      setError('This code has expired. Please request a new one.')
      return
    }
    const code = otpDigits.join('')
    if (code.length < 6) {
      setError('Please enter the full 6-digit code.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await verifyPasswordResetOtp(email.trim(), code)
      setStep('new-password')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      setError(
        msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('invalid')
          ? 'This code is invalid or has expired. Please request a new code.'
          : msg || 'Verification failed. Please try again.'
      )
      setOtpDigits(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!allReqsMet) { setError('Please meet all password requirements.'); return }
    if (!passwordsMatch) { setError('Passwords do not match.'); return }
    setError(null)
    setLoading(true)
    try {
      await updatePassword(password)
      setStep('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const stepLabels = ['Email', 'Verify Code', 'New Password']
  const currentIdx = step === 'email' ? 0 : step === 'otp' ? 1 : step === 'new-password' ? 2 : 3
  const barPct = (expiry / OTP_EXPIRY_SECONDS) * 100
  const barColor = expiry > 120 ? '#15803d' : expiry > 60 ? '#d97706' : '#b91c1c'
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  return (
    <AuthShell>
      <div className="auth-card fade-in">
        <p className="auth-card__eyebrow">Staff Portal</p>

        {/* Progress stepper */}
        {step !== 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            {stepLabels.map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, fontFamily: 'IBM Plex Mono',
                      background: i <= currentIdx ? 'var(--primary)' : 'var(--muted)',
                      color: i <= currentIdx ? '#fff' : 'var(--muted-foreground)',
                      boxShadow: i === currentIdx ? '0 0 0 3px rgba(234,88,12,0.22)' : 'none',
                      transition: 'all 0.25s',
                    }}
                  >
                    {i < currentIdx ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 10.5, color: i === currentIdx ? 'var(--foreground)' : 'var(--muted-foreground)', fontWeight: i === currentIdx ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div style={{ width: 42, height: 2, background: i < currentIdx ? 'var(--primary)' : 'var(--border)', margin: '0 6px 16px' }} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Step 1: Enter email ──────────────────────────── */}
        {step === 'email' && (
          <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h2 className="auth-card__title" style={{ marginBottom: 8 }}>
                Reset Password
              </h2>
              <p style={{ fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0 }}>
                Enter your staff email address and we&apos;ll send a <strong>6-digit code</strong> to reset your password.
              </p>
            </div>

            <div>
              <label htmlFor="forgot-email" style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--foreground)', marginBottom: 8 }}>
                Email Address
              </label>
              <input
                id="forgot-email"
                className="input"
                type="email"
                autoComplete="email"
                required
                placeholder="you@wingtrack.ph"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(null) }}
                style={{ width: '100%', padding: '14px 16px', fontSize: 15 }}
              />
            </div>

            {error && (
              <div style={{ background: '#fce8e8', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#b91c1c', fontWeight: 500 }}>
                {error}
              </div>
            )}

            <button
              id="forgot-submit"
              type="submit"
              className="btn-primary"
              disabled={loading || !email.trim()}
              style={{ padding: '14px', fontSize: 15, fontWeight: 600, borderRadius: 10 }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <span className="spinner" style={{ width: 18, height: 18 }} />
                  Sending Code...
                </span>
              ) : (
                'Send Reset Code'
              )}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {onSignInWithOtp && (
                <button
                  type="button"
                  id="forgot-switch-otp"
                  onClick={() => onSignInWithOtp(email.trim())}
                  style={{
                    background: 'none', border: 'none', color: 'var(--primary)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Or sign in directly with an Email OTP code
                </button>
              )}
              <button
                type="button"
                id="forgot-back-btn"
                onClick={handleSafeBack}
                style={{
                  background: 'none', border: 'none', color: 'var(--muted-foreground)',
                  fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                Back to Sign In
              </button>
            </div>
          </form>
        )}

        {/* ── Step 2: Enter 6-digit reset OTP ──────────────── */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <h2 className="auth-card__title" style={{ fontSize: 20, marginBottom: 6 }}>
                Enter Reset Code
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', lineHeight: 1.55, margin: 0 }}>
                {outcome === 'sent'
                  ? <>A <strong>6-digit code</strong> was sent to<br /><strong style={{ color: 'var(--foreground)' }}>{email.trim().toLowerCase()}</strong></>
                  : <>Check <strong style={{ color: 'var(--foreground)' }}>{email.trim().toLowerCase()}</strong> for your 6-digit code.</>}
              </p>
            </div>

            {outcome === 'unconfirmed' && (
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                Custom SMTP is not configured on this server, so delivery via Supabase&apos;s default mailer may be delayed.
              </div>
            )}

            {info && !expired && (
              <div style={{ background: '#e8f5e9', border: '1px solid #86efac', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#15803d', textAlign: 'center' }}>
                {info}
              </div>
            )}

            {/* Expiry bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', color: 'var(--muted-foreground)' }}>Code expires in</span>
                <span style={{ fontSize: 12.5, fontFamily: 'IBM Plex Mono', fontWeight: 700, color: barColor }}>
                  {expired ? 'EXPIRED' : formatTime(expiry)}
                </span>
              </div>
              <div style={{ height: 5, background: 'var(--muted)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${expired ? 0 : barPct}%`, background: barColor, transition: 'width 1s linear, background 0.5s' }} />
              </div>
            </div>

            {expired && (
              <div style={{ background: '#fce8e8', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', textAlign: 'center' }}>
                Your code has expired. Request a new code below.
              </div>
            )}

            {/* 6-digit boxes */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }} onPaste={handleOtpPaste}>
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el }}
                  id={`forgot-otp-digit-${i}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  disabled={expired}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  onFocus={e => e.target.select()}
                  style={{
                    width: 48, height: 56, borderRadius: 10,
                    border: `2px solid ${expired ? 'var(--muted)' : digit ? 'var(--primary)' : error ? '#b91c1c' : 'var(--border)'}`,
                    textAlign: 'center', fontSize: 22, fontWeight: 700, fontFamily: 'IBM Plex Mono',
                    color: expired ? 'var(--muted-foreground)' : 'var(--foreground)',
                    background: expired ? 'var(--muted)' : digit ? 'rgba(234,88,12,0.05)' : 'var(--card)',
                    outline: 'none', transition: 'all 0.15s',
                    boxShadow: digit && !expired ? '0 0 0 3px rgba(234,88,12,0.12)' : 'none',
                  }}
                />
              ))}
            </div>

            {error && !expired && (
              <div style={{ background: '#fce8e8', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', textAlign: 'center', fontWeight: 500 }}>
                {error}
              </div>
            )}

            {!expired && (
              <button
                id="forgot-verify-otp"
                type="submit"
                className="btn-primary"
                disabled={loading || !allOtpFilled}
                style={{ width: '100%', padding: '13px', fontSize: 15, fontWeight: 600, borderRadius: 10 }}
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span className="spinner" style={{ width: 18, height: 18 }} />
                    Verifying...
                  </span>
                ) : (
                  'Verify Code'
                )}
              </button>
            )}

            <p style={{ fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'center', margin: 0 }}>
              Didn&apos;t receive it? Check your spam folder, then resend below.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                id="forgot-change-email"
                onClick={() => { setStep('email'); setError(null); setInfo(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0 }}
              >
                Change email
              </button>
              <button
                type="button"
                id="forgot-resend-otp"
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: resendCooldown > 0 ? 'var(--muted-foreground)' : 'var(--primary)',
                  fontSize: 13, fontWeight: 600,
                  cursor: resendCooldown > 0 ? 'default' : 'pointer',
                }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>

            {onSignInWithOtp && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  id="forgot-use-otp"
                  onClick={() => onSignInWithOtp(email.trim())}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Sign in with Email OTP instead
                </button>
              </div>
            )}
          </form>
        )}

        {/* ── Step 3: Create new password ──────────────────── */}
        {step === 'new-password' && (
          <form onSubmit={handleUpdatePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 className="auth-card__title" style={{ fontSize: 20, marginBottom: 6 }}>
                Create New Password
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', lineHeight: 1.5, margin: 0 }}>
                Code verified for <strong style={{ color: 'var(--foreground)' }}>{email.trim().toLowerCase()}</strong>. Choose a strong new password below.
              </p>
            </div>

            <div>
              <label htmlFor="forgot-new-pwd" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 7 }}>
                New Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="forgot-new-pwd"
                  className="input"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null) }}
                  style={{ width: '100%', padding: '13px 44px 13px 14px', fontSize: 14 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(p => !p)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center' }}
                >
                  {showPwd ? <EyeOff /> : <Eye />}
                </button>
              </div>
              {password.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5, padding: '10px 12px', background: 'var(--muted)', borderRadius: 8 }}>
                  <Req met={reqs.length} label={`At least ${MIN_PASSWORD_LENGTH} characters`} />
                  <Req met={reqs.uppercase} label="One uppercase letter (A–Z)" />
                  <Req met={reqs.number} label="One number (0–9)" />
                  <Req met={reqs.special} label="One special character (!@#$…)" />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="forgot-confirm-pwd" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 7 }}>
                Confirm New Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="forgot-confirm-pwd"
                  className="input"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setError(null) }}
                  style={{
                    width: '100%', padding: '13px 44px 13px 14px', fontSize: 14,
                    borderColor: confirmPassword.length > 0 ? (passwordsMatch ? '#15803d' : '#b91c1c') : undefined,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(p => !p)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center' }}
                >
                  {showConfirm ? <EyeOff /> : <Eye />}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <p style={{ fontSize: 12, marginTop: 5, marginBottom: 0, color: passwordsMatch ? '#15803d' : '#b91c1c', fontWeight: 500 }}>
                  {passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
            </div>

            {error && (
              <div style={{ background: '#fce8e8', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c', fontWeight: 500 }}>
                {error}
              </div>
            )}

            <button
              id="forgot-update-pwd"
              type="submit"
              className="btn-primary"
              disabled={loading || !allReqsMet || !passwordsMatch}
              style={{ padding: '14px', fontSize: 15, fontWeight: 600, borderRadius: 10 }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <span className="spinner" style={{ width: 18, height: 18 }} />
                  Updating Password...
                </span>
              ) : (
                'Update Password'
              )}
            </button>

            <div style={{ textAlign: 'center' }}>
              <button
                type="button"
                onClick={handleSafeBack}
                style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel and return to Sign In
              </button>
            </div>
          </form>
        )}

        {/* ── Step 4: Done ─────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <div
              style={{
                width: 60, height: 60, borderRadius: '50%', background: '#e8f5e9',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="auth-card__title" style={{ fontSize: 22, marginBottom: 10 }}>
              Password Updated!
            </h2>
            <p style={{ fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.6, marginBottom: 24 }}>
              Your password has been reset successfully. You can now sign in with your new password.
            </p>
            <button
              id="forgot-back-to-login"
              onClick={onBack}
              className="btn-primary"
              style={{ width: '100%', padding: '13px', fontSize: 15, fontWeight: 600, borderRadius: 10 }}
            >
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
