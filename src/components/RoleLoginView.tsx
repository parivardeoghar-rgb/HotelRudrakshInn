import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChefHat,
  CreditCard,
  KeyRound,
  MailCheck,
  Phone,
  QrCode,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Utensils,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { HOTEL_HERO_IMAGE } from '../data/seedCatalog';
import {
  BAIDYANATH_MEDIA_LOGO,
  type PortalKey,
} from '../types';

interface RoleLoginViewProps {
  portal: PortalKey;
  authLoading: boolean;
  authError: string | null;
  requireCustomerLogin?: boolean;
  onBackToPortals: () => void;
  onAuthenticated: (user: User, portal: PortalKey) => Promise<void>;
  onOpenGuestMenu: (tableId: string) => void;
}

const PORTAL_META: Record<
  PortalKey,
  {
    title: string;
    kicker: string;
    route: string;
    subtitle: string;
    highlights: string[];
    icon: React.ComponentType<{ className?: string }>;
    panelBg: string;
    badgeText: string;
  }
> = {
  customer: {
    title: 'Customer Dining Portal',
    kicker: 'Hotel Rudraksh Inn · Guest Account',
    route: '/customer/login',
    subtitle: 'Sign in or register to order from your table, track live dishes, and view past orders.',
    highlights: ['Browse full menu', 'QR table ordering', 'Live order status', 'Order history & feedback'],
    icon: Utensils,
    panelBg: 'from-[#10261F] via-[#141518] to-[#141518]',
    badgeText: 'Customer Portal',
  },
  admin: {
    title: 'Super Admin Console',
    kicker: 'Executive Governance & Security',
    route: '/admin/login',
    subtitle: 'Full authorized control over staff accounts, RBAC permissions, analytics, and hotel settings.',
    highlights: ['Create & manage staff', 'Assign roles & permissions', 'Audit logs & security', 'Revenue & GST reports'],
    icon: ShieldCheck,
    panelBg: 'from-[#241B0A] via-[#141518] to-[#141518]',
    badgeText: 'Admin Access',
  },
  manager: {
    title: 'Restaurant Manager Portal',
    kicker: 'Floor & Operations Control',
    route: '/manager/login',
    subtitle: 'Coordinate tables, waiter shifts, menu availability, inventory levels, and daily operations.',
    highlights: ['Sales & table oversight', 'Waiter assignments', 'Menu & stock control', 'Shift reports'],
    icon: TrendingUp,
    panelBg: 'from-[#0D1E2E] via-[#141518] to-[#141518]',
    badgeText: 'Manager Access',
  },
  cashier: {
    title: 'Cashier POS & Billing',
    kicker: 'Settlement & GST Invoicing',
    route: '/cashier/login',
    subtitle: 'Generate bills, apply authorized discounts, accept Cash/UPI/Card/Split payments, and print receipts.',
    highlights: ['Active table bills', 'Discounts & GST engine', 'Split & UPI settlement', 'Print receipts'],
    icon: CreditCard,
    panelBg: 'from-[#161933] via-[#141518] to-[#141518]',
    badgeText: 'Cashier POS',
  },
  waiter: {
    title: 'Waiter Service Terminal',
    kicker: 'Steward & Table Service',
    route: '/waiter/login',
    subtitle: 'Take table orders, modify items, transfer or merge tables, and respond to guest QR requests.',
    highlights: ['Assigned floor tables', 'Create & add order items', 'Table transfer & merge', 'Live QR alerts'],
    icon: UserCheck,
    panelBg: 'from-[#241D11] via-[#141518] to-[#141518]',
    badgeText: 'Waiter Portal',
  },
  kitchen: {
    title: 'Kitchen Display System (KDS)',
    kicker: 'Culinary Preparation Queue',
    route: '/kitchen/login',
    subtitle: 'Manage incoming tickets in real time from Accepted to Preparing, Ready, and Completed.',
    highlights: ['Live order queue', 'Urgent priority flags', 'Special chef instructions', 'Stock level check'],
    icon: ChefHat,
    panelBg: 'from-[#2A1318] via-[#141518] to-[#141518]',
    badgeText: 'Kitchen Staff',
  },
};

export const RoleLoginView: React.FC<RoleLoginViewProps> = ({
  portal,
  authLoading,
  authError,
  requireCustomerLogin,
  onBackToPortals,
  onAuthenticated,
  onOpenGuestMenu,
}) => {
  const meta = PORTAL_META[portal];
  const Icon = meta.icon;

  const [mode, setMode] = useState<'signin' | 'register' | 'reset' | 'phone'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneInput, setPhoneInput] = useState('+91');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestTable, setGuestTable] = useState('T1');
  const [unverifiedUser, setUnverifiedUser] = useState<User | null>(null);

  const isLoading = authLoading || busy;
  const displayError = localError || authError;

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setLocalSuccess(null);
    setUnverifiedUser(null);
    setBusy(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await onAuthenticated(result.user, portal);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalSuccess(null);
    setUnverifiedUser(null);
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (portal !== 'customer' && !cred.user.emailVerified) {
        setUnverifiedUser(cred.user);
        setLocalError(
          'Please verify your email address before accessing staff dashboards. Check your inbox or click Resend Verification below.'
        );
        return;
      }
      await onAuthenticated(cred.user, portal);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setLocalError(
          'Email/Password sign-in is not yet enabled in Firebase Console. Use Sign in with Google or enable Email/Password provider in Firebase Authentication.'
        );
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setLocalError('Invalid email or password. Use Forgot Password if you need to reset it.');
      } else {
        setLocalError(err instanceof Error ? err.message : 'Unable to sign in.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (portal !== 'customer') return;
    setLocalError(null);
    setLocalSuccess(null);
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (fullName.trim()) {
        await updateProfile(cred.user, { displayName: fullName.trim().slice(0, 80) });
      }
      try {
        await sendEmailVerification(cred.user);
      } catch {
        // optional for customer immediate login
      }
      await onAuthenticated(cred.user, 'customer');
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setLocalError(
          'Email/Password registration is not enabled in Firebase Console. You can sign in immediately with Google.'
        );
      } else {
        setLocalError(err instanceof Error ? err.message : 'Registration failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalSuccess(null);
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setLocalSuccess(`Password reset link sent to ${email.trim()}. Check your inbox.`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to send password reset email.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalSuccess(null);
    setBusy(true);
    try {
      const verifier = new RecaptchaVerifier(auth, 'customer-recaptcha-container', {
        size: 'invisible',
      });
      const result = await signInWithPhoneNumber(auth, phoneInput.trim(), verifier);
      setConfirmationResult(result);
      setLocalSuccess('Verification OTP sent to your phone.');
    } catch (err) {
      setLocalError(
        err instanceof Error
          ? err.message
          : 'Phone authentication requires Phone Sign-In enabled in Firebase Console.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    setLocalError(null);
    setBusy(true);
    try {
      const cred = await confirmationResult.confirm(otpCode.trim());
      await onAuthenticated(cred.user, 'customer');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid OTP code.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedUser) return;
    setBusy(true);
    try {
      await sendEmailVerification(unverifiedUser);
      setLocalSuccess(`Verification email re-sent to ${unverifiedUser.email}.`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#141518] text-zinc-100 grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Left Portal Identity Panel */}
      <div
        className={`lg:col-span-6 relative overflow-hidden flex flex-col justify-between p-8 lg:p-14 bg-gradient-to-br ${meta.panelBg}`}
      >
        <img
          src={HOTEL_HERO_IMAGE}
          alt="Hotel Rudraksh Inn"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover opacity-25"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#141518] via-[#141518]/65 to-transparent" />

        <div className="relative z-10 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBackToPortals}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-[#D4AF37]" />
            All Portals
          </button>

          <span className="font-mono-tabular text-xs text-zinc-300">{meta.route}</span>
        </div>

        <div className="relative z-10 my-10 lg:my-0 max-w-lg">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-[#D4AF37]">
            <Icon className="w-4 h-4" />
            <span>{meta.badgeText}</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white mt-2 text-balance">
            {meta.title}
          </h1>
          <p className="text-sm text-zinc-300 mt-3 leading-relaxed">{meta.subtitle}</p>

          <div className="mt-7 grid grid-cols-2 gap-3 pt-6 border-t border-white/15">
            {meta.highlights.map((h) => (
              <div key={h} className="flex items-center gap-2 text-xs text-zinc-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                <span>{h}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10 text-xs text-zinc-400">
          <span>Hotel Rudraksh Inn · Deoghar</span>
          <div className="flex items-center gap-2">
            <img
              src={BAIDYANATH_MEDIA_LOGO}
              alt="Baidyanath Media"
              className="w-6 h-6 rounded object-cover bg-[#F4F1EA]"
            />
            <span>Baidyanath Media Agency</span>
          </div>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="lg:col-span-6 bg-[#FAFAFA] text-zinc-900 flex flex-col justify-between p-6 sm:p-10 lg:p-14">
        <div className="max-w-md w-full mx-auto my-auto space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[#9A7415]">
              {meta.kicker}
            </div>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-zinc-900 mt-1">
              {mode === 'register'
                ? 'Create Customer Account'
                : mode === 'reset'
                ? 'Reset Password'
                : mode === 'phone'
                ? 'Phone Number Sign-In'
                : `Sign in to ${meta.title}`}
            </h2>
          </div>

          {/* Auth Mode Tabs */}
          {portal === 'customer' ? (
            <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-200/80 rounded-xl text-xs">
              {(
                [
                  { id: 'signin', label: 'Sign In' },
                  { id: 'register', label: 'Register' },
                  { id: 'phone', label: 'Phone' },
                  { id: 'reset', label: 'Reset' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setMode(t.id);
                    setLocalError(null);
                    setLocalSuccess(null);
                  }}
                  className={`py-2 rounded-lg font-semibold transition-colors cursor-pointer ${
                    mode === t.id ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 p-1 bg-zinc-200/80 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setLocalError(null);
                  setLocalSuccess(null);
                }}
                className={`px-4 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  mode === 'signin' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
                }`}
              >
                Staff Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setLocalError(null);
                  setLocalSuccess(null);
                }}
                className={`px-4 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  mode === 'reset' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
                }`}
              >
                Forgot Password
              </button>
            </div>
          )}

          {displayError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{displayError}</p>
                {unverifiedUser && (
                  <button
                    type="button"
                    onClick={() => void handleResendVerification()}
                    className="inline-flex items-center gap-1.5 font-semibold text-red-900 underline cursor-pointer"
                  >
                    <MailCheck className="w-3.5 h-3.5" />
                    Resend Verification Email
                  </button>
                )}
              </div>
            </div>
          )}

          {localSuccess && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{localSuccess}</span>
            </div>
          )}

          {/* Sign In Form */}
          {mode === 'signin' && (
            <form onSubmit={(e) => void handleEmailSignIn(e)} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@hotelrudrakshinn.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>{isLoading ? 'Verifying Credentials...' : 'Sign in with Email'}</span>
              </button>
            </form>
          )}

          {/* Customer Register Form */}
          {mode === 'register' && portal === 'customer' && (
            <form onSubmit={(e) => void handleCustomerRegister(e)} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">
                  Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create password"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-60"
              >
                {isLoading ? 'Creating Account...' : 'Create Customer Account'}
              </button>
            </form>
          )}

          {/* Phone OTP Form (Customer) */}
          {mode === 'phone' && portal === 'customer' && (
            <div className="space-y-3 text-xs">
              <div id="customer-recaptcha-container" />
              {!confirmationResult ? (
                <form onSubmit={(e) => void handleSendOtp(e)} className="space-y-3">
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">
                      Mobile Number (with country code)
                    </label>
                    <input
                      type="tel"
                      required
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Phone className="w-4 h-4" />
                    <span>{isLoading ? 'Sending OTP...' : 'Send OTP Code'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => void handleVerifyOtp(e)} className="space-y-3">
                  <div>
                    <label className="block font-semibold text-zinc-700 mb-1">6-Digit OTP</label>
                    <input
                      type="text"
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm font-mono-tabular"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm cursor-pointer"
                  >
                    {isLoading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Reset Password Form */}
          {mode === 'reset' && (
            <form onSubmit={(e) => void handleResetPassword(e)} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">
                  Registered Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter account email"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C59B27]"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-4 rounded-xl bg-[#141518] text-[#D4AF37] font-semibold text-sm cursor-pointer disabled:opacity-60"
              >
                {isLoading ? 'Sending...' : 'Send Password Reset Email'}
              </button>
            </form>
          )}

          {/* Google Sign-In Divider + Button */}
          <div className="space-y-3">
            <div className="relative flex items-center justify-center">
              <div className="border-t border-zinc-200 w-full" />
              <span className="bg-[#FAFAFA] px-3 text-[11px] text-zinc-400 whitespace-nowrap">
                Or continue with Google
              </span>
              <div className="border-t border-zinc-200 w-full" />
            </div>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => void handleGoogleSignIn()}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-900 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#9A7415]" />
                <span>Sign in with Google</span>
              </span>
              <ArrowRight className="w-4 h-4 text-zinc-400" />
            </button>
          </div>

          {/* Guest Ordering Option for Customer Portal */}
          {portal === 'customer' && (
            <div className="pt-4 border-t border-zinc-200">
              <div className="p-4 rounded-xl bg-white border border-zinc-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-zinc-900">
                      {requireCustomerLogin
                        ? 'Browse Digital Menu (Sign-In Required to Order)'
                        : 'Continue as QR Table Guest'}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {requireCustomerLogin
                        ? 'Restaurant currently requires customer login to place table orders.'
                        : 'No account needed · Browse menu & place table orders directly'}
                    </div>
                  </div>
                  <QrCode className="w-4 h-4 text-[#9A7415]" />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={guestTable}
                    onChange={(e) => setGuestTable(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-zinc-50 border border-zinc-300 rounded-lg"
                  >
                    <option value="T1">Table T1 · Main Dining Hall</option>
                    <option value="T2">Table T2 · Main Dining Hall</option>
                    <option value="T5">Table T5 · Courtyard Terrace</option>
                    <option value="T7">Table T7 · Family AC Hall</option>
                    <option value="T9">Table V1 · Rudraksh VIP Lounge</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => onOpenGuestMenu(guestTable)}
                    className="px-3.5 py-2 rounded-lg bg-[#C59B27] text-[#141518] font-semibold text-xs hover:bg-[#D4AF37] cursor-pointer whitespace-nowrap"
                  >
                    Open Menu
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="mt-8 pt-4 border-t border-zinc-200 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span>Role verified securely from backend Firestore profile</span>
          <a
            href="https://www.baidyanathmedia.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium text-zinc-700 hover:text-[#9A7415]"
          >
            <img
              src={BAIDYANATH_MEDIA_LOGO}
              alt="Baidyanath Media"
              className="w-5 h-5 rounded object-cover bg-[#F4F1EA]"
            />
            <span>Baidyanath Media Agency</span>
          </a>
        </footer>
      </div>
    </div>
  );
};
