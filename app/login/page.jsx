'use client';

import Image from 'next/image';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { clearCurrentUser, getCurrentUser, setCurrentUser } from '@/lib/session';
import { supabase } from '@/lib/supabaseClient';
import { clearUserLocalCache } from '@/lib/storage';
import { clearMenuReadyBundles } from '@/lib/menuReadyBundle';

const LANG_KEY = 'APP_LANG_V1';
const ACCOUNT_CACHE_ISOLATION_VERSION = '2';
const accountCacheIsolationKey = (userId) => `MENU_ACCOUNT_CACHE_ISOLATION_V${ACCOUNT_CACHE_ISOLATION_VERSION}__${userId}`;
const TEXT = {
  ko: {
    promptSetNewPassword: '새 비밀번호를 설정해 주세요.',
    errorLoginGeneric: '로그인 중 오류가 발생했습니다.',
    signupMissingFields: '모든 필드를 입력해 주세요.',
    signupNeedOtp: '이메일 인증을 완료해 주세요.',
    signupPasswordMismatch: '비밀번호와 비밀번호 확인이 일치하지 않습니다.',
    signupSuccess: '회원가입이 완료되었습니다!',
    signupGenericError: '회원가입 중 오류가 발생했습니다.',
    authInvalidEmail: '인증 메일을 받을 수 없는 이메일 주소입니다. 실제로 사용하는 이메일 주소로 다시 시도해 주세요.',
    authRateLimit: '인증 메일 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    signupNeedEmail: '이메일을 입력해 주세요.',
    signupExistingEmail: '이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.',
    signupOtpSent: '이메일로 8자리 인증번호를 보냈습니다. 받은 번호를 입력해 주세요.',
    signupSendError: '인증 메일 전송 중 오류가 발생했습니다.',
    signupOtpNeedEmail: '이메일을 입력해 주세요.',
    signupOtpNeedToken: '이메일로 받은 인증번호를 입력해 주세요.',
    signupOtpInvalidFormat: '인증번호는 8자리 숫자여야 합니다.',
    signupOtpVerified: '이메일 인증 완료! 비밀번호를 설정해 회원가입을 마무리해 주세요.',
    signupOtpVerifyError: '인증 중 오류가 발생했습니다.',
    recoverNeedEmail: '이메일을 입력해 주세요.',
    recoverEmailNotFound: '가입되지 않은 이메일입니다.',
    recoverEmailSent: '비밀번호 재설정 링크를 이메일로 전송했습니다. 메일을 확인해 주세요.',
    recoverSendError: '메일 전송 중 오류가 발생했습니다.',
    recoverNoSession: '이메일 링크를 통해 들어온 후 새 비밀번호를 설정할 수 있습니다.',
    recoverNeedNewPassword: '새 비밀번호를 입력해 주세요.',
    recoverUpdated: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.',
    recoverUpdateError: '비밀번호 변경 중 오류가 발생했습니다.',
    loginEmailLabel: '아이디(이메일)',
    loginEmailPlaceholder: '이메일을 입력하세요',
    loginPasswordLabel: '비밀번호',
    loginPasswordPlaceholder: '비밀번호를 입력하세요',
    loginButton: '로그인',
    loginButtonLoading: '로그인 중...',
    loginButtonPreparing: '준비 중...',
    signupLink: '회원가입',
    recoverLink: '비밀번호 찾기',
    signupTitle: '회원가입',
    signupEmailLabel: '이메일',
    signupEmailPlaceholder: '이메일을 입력하세요',
    signupSendOtp: '인증 보내기',
    signupSendOtpLoading: '발송 중...',
    signupOtpLabel: '이메일 인증번호',
    signupOtpPlaceholder: '이메일로 받은 8자리 코드를 입력하세요',
    signupVerify: '인증 확인',
    signupVerifyLoading: '확인 중...',
    signupVerifiedNotice: '이메일 인증이 완료되었습니다.',
    signupPasswordLabel: '비밀번호',
    signupPasswordPlaceholder: '비밀번호를 입력하세요',
    signupConfirmLabel: '비밀번호 확인',
    signupConfirmPlaceholder: '비밀번호를 다시 입력하세요',
    signupSubmit: '회원가입',
    signupSubmitLoading: '가입 중...',
    backToLogin: '로그인으로 돌아가기',
    recoverTitle: '비밀번호 찾기',
    recoverEmailLabel: '이메일 주소',
    recoverEmailPlaceholder: '가입 시 사용한 이메일을 입력하세요',
    recoverSendButton: '재설정 메일 보내기',
    recoverSendButtonLoading: '메일 전송 중...',
    recoverNewPasswordLabel: '새 비밀번호',
    recoverNewPasswordPlaceholder: '새 비밀번호를 입력하세요',
    recoverSetPassword: '새 비밀번호 설정',
    recoverSetPasswordLoading: '변경 중...',
  },
  en: {
    promptSetNewPassword: 'Please set a new password.',
    errorLoginGeneric: 'An error occurred while logging in.',
    signupMissingFields: 'Please fill in all fields.',
    signupNeedOtp: 'Please complete email verification.',
    signupPasswordMismatch: 'Password and confirmation do not match.',
    signupSuccess: 'Sign-up completed!',
    signupGenericError: 'An error occurred during sign-up.',
    authInvalidEmail: 'This email address cannot receive authentication email. Please try a real email address.',
    authRateLimit: 'Too many authentication email requests. Please try again later.',
    signupNeedEmail: 'Please enter your email.',
    signupExistingEmail: 'This email is already registered. Please log in or use password recovery.',
    signupOtpSent: 'Sent an 8-digit verification code to your email. Please enter it.',
    signupSendError: 'Failed to send the verification email.',
    signupOtpNeedEmail: 'Please enter your email.',
    signupOtpNeedToken: 'Please enter the verification code sent to your email.',
    signupOtpInvalidFormat: 'The verification code must be 8 digits.',
    signupOtpVerified: 'Email verified! Set a password to finish sign-up.',
    signupOtpVerifyError: 'An error occurred during verification.',
    recoverNeedEmail: 'Please enter your email.',
    recoverEmailNotFound: 'This email is not registered.',
    recoverEmailSent: 'Sent a password reset link to your email. Please check your inbox.',
    recoverSendError: 'An error occurred while sending the email.',
    recoverNoSession: 'Open the link from your email to set a new password.',
    recoverNeedNewPassword: 'Please enter a new password.',
    recoverUpdated: 'Password updated. Please log in with the new password.',
    recoverUpdateError: 'An error occurred while updating the password.',
    loginEmailLabel: 'Email',
    loginEmailPlaceholder: 'Enter your email',
    loginPasswordLabel: 'Password',
    loginPasswordPlaceholder: 'Enter your password',
    loginButton: 'Log in',
    loginButtonLoading: 'Logging in...',
    loginButtonPreparing: 'Preparing...',
    signupLink: 'Sign up',
    recoverLink: 'Forgot password',
    signupTitle: 'Sign up',
    signupEmailLabel: 'Email',
    signupEmailPlaceholder: 'Enter your email',
    signupSendOtp: 'Send code',
    signupSendOtpLoading: 'Sending...',
    signupOtpLabel: 'Email verification code',
    signupOtpPlaceholder: 'Enter the 8-digit code sent to your email',
    signupVerify: 'Verify',
    signupVerifyLoading: 'Verifying...',
    signupVerifiedNotice: 'Email verification completed.',
    signupPasswordLabel: 'Password',
    signupPasswordPlaceholder: 'Enter your password',
    signupConfirmLabel: 'Confirm password',
    signupConfirmPlaceholder: 'Re-enter your password',
    signupSubmit: 'Create account',
    signupSubmitLoading: 'Signing up...',
    backToLogin: 'Back to login',
    recoverTitle: 'Password recovery',
    recoverEmailLabel: 'Email address',
    recoverEmailPlaceholder: 'Enter the email you used to sign up',
    recoverSendButton: 'Send reset email',
    recoverSendButtonLoading: 'Sending email...',
    recoverNewPasswordLabel: 'New password',
    recoverNewPasswordPlaceholder: 'Enter your new password',
    recoverSetPassword: 'Set new password',
    recoverSetPasswordLoading: 'Updating...',
  },
};

const INITIAL_LOGIN_FORM = { id: '', password: '' };
const INITIAL_SIGNUP_FORM = { email: '', password: '', confirm: '', otp: '' };
const INITIAL_OTP_STATE = { sending: false, sent: false, verifying: false, verified: false };
const INITIAL_PASSWORD_RECOVERY = {
  email: '',
  newPassword: '',
  message: '',
  messageKey: null,
  sending: false,
  updating: false,
};

// ✅ “이미 가입된 이메일” 판단을 위한 안전 임계치(분)
// - OTP verify 후 세션이 생겼는데, user.created_at이 너무 오래 전이면(기존 계정)
// - 회원가입 플로우를 막고 비번찾기로 유도
const EXISTING_ACCOUNT_CUTOFF_MS = 5 * 60 * 1000; // 5 minutes

function getAuthEmailErrorMessageKey(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('rate limit')) return 'authRateLimit';
  if (text.includes('email address') && text.includes('invalid')) return 'authInvalidEmail';
  return null;
}

export default function LoginPage() {
  const router = useRouter();

  const [form, setForm] = useState(INITIAL_LOGIN_FORM);
  const [signUpForm, setSignUpForm] = useState(INITIAL_SIGNUP_FORM);

  const [activeView, setActiveView] = useState('login');
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [lang, setLang] = useState('en');

  const [loginMessageKey, setLoginMessageKey] = useState(null);
  const [signUpMessageKey, setSignUpMessageKey] = useState(null);
  const [passwordRecoveryMessageKey, setPasswordRecoveryMessageKey] = useState(null);

  const translate = useCallback((key) => TEXT[lang]?.[key] ?? TEXT.en[key] ?? key, [lang]);

  // ✅ 로그인 메시지/로딩
  const [loginMessage, setLoginMessage] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAuthResetting, setIsAuthResetting] = useState(true);

  // ✅ 회원가입 메시지/로딩
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [signUpMessage, setSignUpMessage] = useState('');

  // ✅ OTP 상태
  const [otpState, setOtpState] = useState(INITIAL_OTP_STATE);

  // ✅ 비밀번호 찾기/재설정 상태
  const [passwordRecovery, setPasswordRecovery] = useState(INITIAL_PASSWORD_RECOVERY);

  const resetAllFields = useCallback(() => {
    setForm(INITIAL_LOGIN_FORM);
    setSignUpForm(INITIAL_SIGNUP_FORM);
    setOtpState(INITIAL_OTP_STATE);
    setPasswordRecovery(INITIAL_PASSWORD_RECOVERY);
    setPasswordRecoveryMessageKey(null);
    setLoginMessageKey(null);
    setSignUpMessageKey(null);
    setLoginMessage('');
    setSignUpMessage('');
    setHasRecoverySession(false);
  }, []);

  const switchView = useCallback(
    (view) => {
      resetAllFields();
      setActiveView(view);
    },
    [resetAllFields]
  );

  // ✅ Supabase auth 링크로 돌아온 경우 해시 파싱
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const hasAuthHash = hash.includes('access_token=') && hash.includes('refresh_token=');
    if (hasAuthHash) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      const type = params.get('type');

      if (access_token && refresh_token) {
        supabase.auth
          .setSession({ access_token, refresh_token })
          .then(({ data, error }) => {
            if (!error && data?.session?.user) {
              setCurrentUser(data.session.user.id);
              if (type === 'recovery') {
                setHasRecoverySession(true);
                setActiveView('password');
                setPasswordRecoveryMessageKey('promptSetNewPassword');
                setPasswordRecovery((prev) => ({
                  ...prev,
                  email: data.session.user.email || prev.email,
                  message: translate('promptSetNewPassword'),
                  messageKey: 'promptSetNewPassword',
                }));
              } else {
                router.replace('/intro');
              }
            }
          })
          .catch(() => {});
      }
    }
  }, [router, translate]);

  // ✅ 로그인 페이지 접근 시 세션/입력값 초기화
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.location.hash.includes('access_token=') &&
      window.location.hash.includes('refresh_token=')
    ) {
      setIsAuthResetting(false);
      return;
    }

    let alive = true;
    setIsAuthResetting(true);

    Promise.race([
      supabase.auth.signOut().catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, 900)),
    ])
      .catch(() => {})
      .finally(() => {
        if (!alive) return;
        clearCurrentUser();
        resetAllFields();
        setActiveView('login');
        setIsAuthResetting(false);
      });

    return () => {
      alive = false;
    };
  }, [resetAllFields]);

  // ✅ 저장된 언어 불러오기
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'ko' || saved === 'en') setLang(saved);
    } catch {}
  }, []);

  const handleSetLanguage = (nextLang) => {
    setLang(nextLang);
    try {
      localStorage.setItem(LANG_KEY, nextLang);
    } catch {}
  };

  // ✅ auth listener
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user?.id) setCurrentUser(session.user.id);

      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        setHasRecoverySession(true);
        setActiveView('password');
        setPasswordRecoveryMessageKey('promptSetNewPassword');
        setPasswordRecovery((prev) => ({
          ...prev,
          email: session.user.email || prev.email,
          message: translate('promptSetNewPassword'),
          messageKey: 'promptSetNewPassword',
        }));
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [translate]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // ✅✅✅ 로그인 (email/password)
  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    if (isAuthResetting) return;
    setLoginMessage('');
    setLoginMessageKey(null);
    setIsLoggingIn(true);

    try {
      const email = (form.id || '').trim();
      const password = form.password;

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setLoginMessage(error.message);
        return;
      }

      const user = data?.user;
      if (user?.id) {
        const previousUserId = getCurrentUser();
        const cacheIsolationKey = accountCacheIsolationKey(user.id);
        const hasCurrentIsolation = (() => {
          try {
            return localStorage.getItem(cacheIsolationKey) === 'done';
          } catch {
            return false;
          }
        })();
        if ((previousUserId && previousUserId !== user.id) || !hasCurrentIsolation) {
          await Promise.all([
            clearUserLocalCache(user.id),
            clearMenuReadyBundles(),
          ]);
          try {
            localStorage.setItem(cacheIsolationKey, 'done');
          } catch {}
        }
        setCurrentUser(user.id);
      }

      router.push('/intro');
    } catch {
      setLoginMessage(translate('errorLoginGeneric'));
      setLoginMessageKey('errorLoginGeneric');
    } finally {
      setIsLoggingIn(false);
    }
  };

  /**
   * ✅ 회원가입 완료 버튼 동작 (방법 A)
   * - OTP verify 성공 → 세션 생성됨
   * - "기존 계정"이면 비밀번호 변경(덮어쓰기) 위험이 있으니 막고, 비번찾기로 유도
   * - 신규 계정이면 updateUser({password})로 비밀번호 설정 후 가입 완료
   */
  const handleSignUp = async (event) => {
    event.preventDefault();
    setSignUpMessage('');
    setSignUpMessageKey(null);

    if (!signUpForm.email || !signUpForm.password || !signUpForm.confirm) {
      setSignUpMessage(translate('signupMissingFields'));
      setSignUpMessageKey('signupMissingFields');
      return;
    }

    if (!otpState.verified) {
      setSignUpMessage(translate('signupNeedOtp'));
      setSignUpMessageKey('signupNeedOtp');
      return;
    }

    if (signUpForm.password !== signUpForm.confirm) {
      setSignUpMessage(translate('signupPasswordMismatch'));
      setSignUpMessageKey('signupPasswordMismatch');
      return;
    }

    setIsSigningUp(true);

    try {
      // ✅ 현재 로그인된 유저(verifyOtp로 세션 생김) 확인
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        setSignUpMessage(translate('signupGenericError'));
        setSignUpMessageKey('signupGenericError');
        return;
      }

      // ✅ 기존 계정 안전장치: created_at이 너무 오래전이면 "이미 가입된 이메일"로 처리
      const createdAt = userData.user.created_at ? Date.parse(userData.user.created_at) : 0;
      const ageMs = createdAt ? Date.now() - createdAt : 0;

      if (createdAt && ageMs > EXISTING_ACCOUNT_CUTOFF_MS) {
        setSignUpMessage(translate('signupExistingEmail'));
        setSignUpMessageKey('signupExistingEmail');
        // 기존 계정으로 로그인된 상태일 수 있으니 로그아웃 처리
        await supabase.auth.signOut().catch(() => {});
        setOtpState(INITIAL_OTP_STATE);
        return;
      }

      // ✅ 신규 계정이면 비밀번호 세팅(회원가입 완료)
      const { data, error } = await supabase.auth.updateUser({ password: signUpForm.password });

      if (error) {
        setSignUpMessage(error.message);
        setSignUpMessageKey(null);
        return;
      }

      if (data?.user?.id) {
        await Promise.all([
          clearUserLocalCache(data.user.id),
          clearMenuReadyBundles(),
        ]);
        setCurrentUser(data.user.id);
        try {
          localStorage.setItem(accountCacheIsolationKey(data.user.id), 'done');
        } catch {}
      }

      setSignUpMessage(translate('signupSuccess'));
      setSignUpMessageKey('signupSuccess');
      router.push('/intro');
    } catch {
      setSignUpMessage(translate('signupGenericError'));
      setSignUpMessageKey('signupGenericError');
    } finally {
      setIsSigningUp(false);
    }
  };

  /**
   * ✅ 이메일 OTP 보내기 (방법 A)
   * - "기존 유저 체크(shouldCreateUser:false)" 제거
   * - 그냥 보내기만 함 (신규면 생성, 기존이면 로그인 OTP)
   */
  const handleSendEmailOtp = async () => {
    setSignUpMessage('');
    setSignUpMessageKey(null);

    const email = (signUpForm.email || '').trim();
    if (!email) {
      setSignUpMessage(translate('signupNeedEmail'));
      setSignUpMessageKey('signupNeedEmail');
      return;
    }

    setOtpState((prev) => ({
      ...prev,
      sending: true,
      sent: false,
      verifying: false,
      verified: false,
    }));

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // ✅ 핵심: 유저 없으면 생성 허용 (또는 options 자체 제거해도 됨)
          shouldCreateUser: true,
        },
      });

      if (error) {
        const messageKey = getAuthEmailErrorMessageKey(error.message);
        setSignUpMessage(messageKey ? translate(messageKey) : error.message);
        setSignUpMessageKey(messageKey);
        setOtpState((prev) => ({ ...prev, sending: false, sent: false }));
        return;
      }

      setOtpState((prev) => ({ ...prev, sending: false, sent: true }));
      setSignUpMessage(translate('signupOtpSent'));
      setSignUpMessageKey('signupOtpSent');
    } catch {
      setSignUpMessage(translate('signupSendError'));
      setSignUpMessageKey('signupSendError');
      setOtpState((prev) => ({ ...prev, sending: false, sent: false }));
    }
  };

  /**
   * ✅ 이메일 OTP 검증 (8자리)
   * - verify 성공 시 세션 생성됨
   * - 여기서 "기존 계정"이면 바로 안내하고 세션을 끊어서 비번 덮어쓰기 사고 방지
   */
  const handleVerifyEmailOtp = async () => {
    setSignUpMessage('');
    setSignUpMessageKey(null);

    const email = (signUpForm.email || '').trim();
    const token = (signUpForm.otp || '').trim();

    if (!email) {
      setSignUpMessage(translate('signupOtpNeedEmail'));
      setSignUpMessageKey('signupOtpNeedEmail');
      return;
    }

    if (!token) {
      setSignUpMessage(translate('signupOtpNeedToken'));
      setSignUpMessageKey('signupOtpNeedToken');
      return;
    }

    if (!/^\d{8}$/.test(token)) {
      setSignUpMessage(translate('signupOtpInvalidFormat'));
      setSignUpMessageKey('signupOtpInvalidFormat');
      return;
    }

    setOtpState((prev) => ({ ...prev, verifying: true }));

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });

      if (error) {
        setSignUpMessage(error.message);
        setSignUpMessageKey(null);
        setOtpState((prev) => ({ ...prev, verifying: false, verified: false }));
        return;
      }

      const user = data?.session?.user;

      // ✅ 기존 계정 안전장치 (verify 단계에서 바로 차단)
      const createdAt = user?.created_at ? Date.parse(user.created_at) : 0;
      const ageMs = createdAt ? Date.now() - createdAt : 0;

      if (createdAt && ageMs > EXISTING_ACCOUNT_CUTOFF_MS) {
        setSignUpMessage(translate('signupExistingEmail'));
        setSignUpMessageKey('signupExistingEmail');
        setOtpState((prev) => ({ ...prev, verifying: false, verified: false, sent: true }));

        // 기존 계정으로 로그인된 세션이 생겼으니 끊어줌 (비번 덮어쓰기 방지)
        await supabase.auth.signOut().catch(() => {});
        clearCurrentUser();
        return;
      }

      if (user?.id) {
        await Promise.all([
          clearUserLocalCache(user.id),
          clearMenuReadyBundles(),
        ]);
        setCurrentUser(user.id);
        try {
          localStorage.setItem(accountCacheIsolationKey(user.id), 'done');
        } catch {}
      }

      setOtpState((prev) => ({ ...prev, verifying: false, verified: true }));
      setSignUpMessage(translate('signupOtpVerified'));
      setSignUpMessageKey('signupOtpVerified');
    } catch {
      setSignUpMessage(translate('signupOtpVerifyError'));
      setSignUpMessageKey('signupOtpVerifyError');
      setOtpState((prev) => ({ ...prev, verifying: false, verified: false }));
    }
  };

  // ✅ 비밀번호 재설정 메일 발송
  const handleSendPasswordReset = async () => {
    const email = (passwordRecovery.email || '').trim();
    if (!email) {
      setPasswordRecoveryMessageKey('recoverNeedEmail');
      setPasswordRecovery((prev) => ({
        ...prev,
        message: translate('recoverNeedEmail'),
        messageKey: 'recoverNeedEmail',
      }));
      return;
    }

    setPasswordRecoveryMessageKey(null);
    setPasswordRecovery((prev) => ({ ...prev, sending: true, message: '', messageKey: null }));

    try {
      const redirectTo = `${window.location.origin}/login`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

      const notFound = (error?.message || '').toLowerCase().includes('not found');
      const authEmailMessageKey = error ? getAuthEmailErrorMessageKey(error.message) : null;

      setPasswordRecovery((prev) => ({
        ...prev,
        sending: false,
        message: error
          ? notFound
            ? translate('recoverEmailNotFound')
            : authEmailMessageKey
            ? translate(authEmailMessageKey)
            : error.message
          : translate('recoverEmailSent'),
        messageKey: error
          ? notFound
            ? 'recoverEmailNotFound'
            : authEmailMessageKey
          : 'recoverEmailSent',
      }));
      setPasswordRecoveryMessageKey(
        error ? (notFound ? 'recoverEmailNotFound' : authEmailMessageKey) : 'recoverEmailSent'
      );
    } catch {
      setPasswordRecovery((prev) => ({
        ...prev,
        sending: false,
        message: translate('recoverSendError'),
        messageKey: 'recoverSendError',
      }));
      setPasswordRecoveryMessageKey('recoverSendError');
    }
  };

  // ✅ 비밀번호 재설정 (recovery 세션에서만 가능)
  const handlePasswordReset = async (event) => {
    event.preventDefault();

    if (!hasRecoverySession) {
      setPasswordRecovery((prev) => ({
        ...prev,
        message: translate('recoverNoSession'),
        messageKey: 'recoverNoSession',
      }));
      setPasswordRecoveryMessageKey('recoverNoSession');
      return;
    }

    if (!passwordRecovery.newPassword) {
      setPasswordRecovery((prev) => ({
        ...prev,
        message: translate('recoverNeedNewPassword'),
        messageKey: 'recoverNeedNewPassword',
      }));
      setPasswordRecoveryMessageKey('recoverNeedNewPassword');
      return;
    }

    setPasswordRecoveryMessageKey(null);
    setPasswordRecovery((prev) => ({ ...prev, updating: true, message: '', messageKey: null }));

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordRecovery.newPassword,
      });

      if (error) {
        setPasswordRecovery((prev) => ({
          ...prev,
          updating: false,
          message: error.message,
          messageKey: null,
        }));
        return;
      }

      setPasswordRecovery((prev) => ({
        ...prev,
        updating: false,
        message: translate('recoverUpdated'),
        messageKey: 'recoverUpdated',
      }));
      setPasswordRecoveryMessageKey('recoverUpdated');
      router.push('/intro');
    } catch {
      setPasswordRecovery((prev) => ({
        ...prev,
        updating: false,
        message: translate('recoverUpdateError'),
        messageKey: 'recoverUpdateError',
      }));
      setPasswordRecoveryMessageKey('recoverUpdateError');
    }
  };

  useEffect(() => {
    if (loginMessageKey) setLoginMessage(translate(loginMessageKey));
    if (signUpMessageKey) setSignUpMessage(translate(signUpMessageKey));
    setPasswordRecovery((prev) => ({
      ...prev,
      message: passwordRecoveryMessageKey ? translate(passwordRecoveryMessageKey) : prev.message,
      messageKey: passwordRecoveryMessageKey ?? prev.messageKey ?? null,
    }));
  }, [lang, loginMessageKey, signUpMessageKey, passwordRecoveryMessageKey, translate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f1115',
        color: '#f4f4f4',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div style={langStyles.wrap}>
        <div style={langStyles.row}>
          <button
            style={{
              ...langStyles.button,
              ...(lang === 'en' ? langStyles.buttonActive : {}),
            }}
            onClick={() => handleSetLanguage('en')}
            aria-label="English"
            title="English"
          >
            🇺🇸
          </button>
          <button
            style={{
              ...langStyles.button,
              ...(lang === 'ko' ? langStyles.buttonActive : {}),
            }}
            onClick={() => handleSetLanguage('ko')}
            aria-label="한국어"
            title="한국어"
          >
            🇰🇷
          </button>
        </div>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          background: 'rgba(255, 255, 255, 0.055)',
          borderRadius: '14px',
          boxShadow: '0 22px 55px rgba(0, 0, 0, 0.36)',
          padding: '32px',
          boxSizing: 'border-box',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px',
          }}
        >
          <div
            aria-label="회사 로고"
            style={{
              width: '200px',
              height: '80px',
              position: 'relative',
            }}
          >
            <Image
              src="/circle-pay-logo.svg"
              alt="Circle Pay 로고"
              fill
              sizes="200px"
              style={{ objectFit: 'contain' }}
              priority
            />
          </div>
        </div>

        {activeView === 'login' && (
          <>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
                {translate('loginEmailLabel')}
                <input
                  type="text"
                  name="id"
                  value={form.id}
                  onChange={handleChange}
                  disabled={isAuthResetting || isLoggingIn}
                  required
                  placeholder={translate('loginEmailPlaceholder')}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(15,23,42,0.72)',
                    color: '#f4f4f4',
                    outline: 'none',
                    fontSize: '15px',
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
                {translate('loginPasswordLabel')}
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  disabled={isAuthResetting || isLoggingIn}
                  required
                  placeholder={translate('loginPasswordPlaceholder')}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(15,23,42,0.72)',
                    color: '#f4f4f4',
                    outline: 'none',
                    fontSize: '15px',
                  }}
                />
              </label>

              <div>
                <button
                  type="submit"
                  disabled={isAuthResetting || isLoggingIn}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.10)',
                    background: isAuthResetting || isLoggingIn
                      ? 'rgba(15,118,110,0.38)'
                      : '#0f766e',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: '16px',
                    cursor: isAuthResetting || isLoggingIn ? 'not-allowed' : 'pointer',
                    boxShadow: isAuthResetting || isLoggingIn ? 'none' : '0 12px 28px rgba(0, 0, 0, 0.26)',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    opacity: isAuthResetting || isLoggingIn ? 0.85 : 1,
                  }}
                >
                  {isAuthResetting
                    ? translate('loginButtonPreparing')
                    : isLoggingIn
                    ? translate('loginButtonLoading')
                    : translate('loginButton')}
                </button>
              </div>

              {!!loginMessage && (
                <div style={{ marginTop: '6px', color: '#f1b3b3', fontSize: '14px' }}>{loginMessage}</div>
              )}
            </form>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '16px',
                marginTop: '18px',
                color: '#8f96a3',
                fontSize: '14px',
              }}
            >
              <button
                type="button"
                onClick={() => switchView('signup')}
                style={{
                  color: 'inherit',
                  textDecoration: 'none',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {translate('signupLink')}
              </button>
              <span aria-hidden="true">|</span>
              <button
                type="button"
                onClick={() => switchView('password')}
                style={{
                  color: 'inherit',
                  textDecoration: 'none',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 'inherit',
                  fontFamily: 'inherit',
                }}
              >
                {translate('recoverLink')}
              </button>
            </div>
          </>
        )}

        {activeView === 'signup' && (
          <div style={{ padding: '8px 0 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: '#d8dce5', fontWeight: 700, textAlign: 'center' }}>
              {translate('signupTitle')}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
              {translate('signupEmailLabel')}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="email"
                  value={signUpForm.email}
                  onChange={(event) => {
                    const nextEmail = event.target.value;
                    setSignUpForm((prev) => ({ ...prev, email: nextEmail }));
                    setOtpState((prev) => ({ ...prev, sent: false, verifying: false, verified: false }));
                    setSignUpMessage('');
                  }}
                  placeholder={translate('signupEmailPlaceholder')}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(15,23,42,0.72)',
                    color: '#f4f4f4',
                    outline: 'none',
                    fontSize: '15px',
                    flex: 1,
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendEmailOtp}
                  disabled={otpState.sending}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: otpState.sending ? 'rgba(15,118,110,0.18)' : 'rgba(15,118,110,0.88)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: otpState.sending ? 'not-allowed' : 'pointer',
                    minWidth: '120px',
                  }}
                >
                  {otpState.sending ? translate('signupSendOtpLoading') : translate('signupSendOtp')}
                </button>
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
              {translate('signupOtpLabel')}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={signUpForm.otp}
                  onChange={(event) => {
                    const v = event.target.value.replace(/\D/g, '').slice(0, 8);
                    setSignUpForm((prev) => ({ ...prev, otp: v }));
                  }}
                  placeholder={translate('signupOtpPlaceholder')}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(15,23,42,0.72)',
                    color: '#f4f4f4',
                    outline: 'none',
                    fontSize: '15px',
                    flex: 1,
                  }}
                />
                <button
                  type="button"
                  onClick={handleVerifyEmailOtp}
                  disabled={!otpState.sent || otpState.verifying}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: otpState.verifying ? 'rgba(15,118,110,0.18)' : 'rgba(15,118,110,0.88)',
                    color: otpState.sent ? '#fff' : '#8f96a3',
                    fontWeight: 900,
                    cursor: !otpState.sent || otpState.verifying ? 'not-allowed' : 'pointer',
                    minWidth: '120px',
                  }}
                >
                  {otpState.verifying ? translate('signupVerifyLoading') : translate('signupVerify')}
                </button>
              </div>
              {otpState.verified && (
                <div style={{ color: '#5eead4', fontSize: '13px' }}>{translate('signupVerifiedNotice')}</div>
              )}
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
              {translate('signupPasswordLabel')}
              <input
                type="password"
                value={signUpForm.password}
                onChange={(event) => setSignUpForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder={translate('signupPasswordPlaceholder')}
                disabled={!otpState.verified}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #242938',
                  background: 'rgba(13, 15, 24, 0.85)',
                  color: '#f4f4f4',
                  outline: 'none',
                  fontSize: '15px',
                  opacity: otpState.verified ? 1 : 0.6,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
              {translate('signupConfirmLabel')}
              <input
                type="password"
                value={signUpForm.confirm}
                onChange={(event) => setSignUpForm((prev) => ({ ...prev, confirm: event.target.value }))}
                placeholder={translate('signupConfirmPlaceholder')}
                disabled={!otpState.verified}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #242938',
                  background: 'rgba(13, 15, 24, 0.85)',
                  color: '#f4f4f4',
                  outline: 'none',
                  fontSize: '15px',
                  opacity: otpState.verified ? 1 : 0.6,
                }}
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={handleSignUp}
                disabled={isSigningUp || !otpState.verified}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background:
                    isSigningUp || !otpState.verified
                      ? 'rgba(15,118,110,0.20)'
                      : '#0f766e',
                  color: isSigningUp || !otpState.verified ? '#8f96a3' : '#fff',
                  fontWeight: 900,
                  fontSize: '16px',
                  cursor: isSigningUp || !otpState.verified ? 'not-allowed' : 'pointer',
                  boxShadow: isSigningUp || !otpState.verified ? 'none' : '0 12px 28px rgba(0, 0, 0, 0.26)',
                  opacity: isSigningUp || !otpState.verified ? 0.85 : 1,
                }}
              >
                {isSigningUp ? translate('signupSubmitLoading') : translate('signupSubmit')}
              </button>

              {!!signUpMessage && (
                <div style={{ marginTop: '6px', color: '#f1b3b3', fontSize: '14px' }}>{signUpMessage}</div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => switchView('login')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                {translate('backToLogin')}
              </button>
            </div>
          </div>
        )}

        {activeView === 'password' && (
          <div style={{ padding: '8px 0 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: '#d8dce5', fontWeight: 700, textAlign: 'center' }}>
              {translate('recoverTitle')}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
              {translate('recoverEmailLabel')}
              <input
                type="email"
                value={passwordRecovery.email}
                onChange={(event) => setPasswordRecovery((prev) => ({ ...prev, email: event.target.value }))}
                placeholder={translate('recoverEmailPlaceholder')}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(15,23,42,0.72)',
                  color: '#f4f4f4',
                  outline: 'none',
                  fontSize: '15px',
                }}
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                onClick={handleSendPasswordReset}
                disabled={passwordRecovery.sending}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#f8fafc',
                  fontWeight: 900,
                  cursor: passwordRecovery.sending ? 'not-allowed' : 'pointer',
                }}
              >
                {passwordRecovery.sending
                  ? translate('recoverSendButtonLoading')
                  : translate('recoverSendButton')}
              </button>

              {hasRecoverySession && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: '#d8dce5' }}>
                  {translate('recoverNewPasswordLabel')}
                  <input
                    type="password"
                    value={passwordRecovery.newPassword}
                    onChange={(event) =>
                      setPasswordRecovery((prev) => ({ ...prev, newPassword: event.target.value }))
                    }
                    placeholder={translate('recoverNewPasswordPlaceholder')}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255,255,255,0.12)',
                      background: 'rgba(15,23,42,0.72)',
                      color: '#f4f4f4',
                      outline: 'none',
                      fontSize: '15px',
                    }}
                  />
                </label>
              )}

              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={passwordRecovery.updating}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: hasRecoverySession
                    ? '#0f766e'
                    : 'rgba(15,118,110,0.16)',
                  color: hasRecoverySession ? '#fff' : '#8f96a3',
                  fontWeight: 900,
                  cursor: hasRecoverySession ? 'pointer' : 'not-allowed',
                  opacity: passwordRecovery.updating ? 0.8 : 1,
                }}
              >
                {passwordRecovery.updating
                  ? translate('recoverSetPasswordLoading')
                  : translate('recoverSetPassword')}
              </button>

              {passwordRecovery.message && (
                <div style={{ color: hasRecoverySession ? '#5eead4' : '#f1b3b3', fontSize: '14px' }}>
                  {passwordRecovery.message}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => switchView('login')}
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                }}
              >
                {translate('backToLogin')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const langStyles = {
  wrap: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 32px)',
    right: 'calc(env(safe-area-inset-right, 0px) + 20px)',
    zIndex: 99999,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'flex-end',
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  button: {
    width: 42,
    height: 34,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.26)',
    background: 'rgba(15,23,42,0.72)',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
    padding: 0,
  },
  buttonActive: {
    border: '1px solid rgba(255,255,255,0.95)',
    background: 'rgba(15,118,110,0.82)',
  },
};
