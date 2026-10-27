import { useState, type FormEvent } from "react";
import { useKeyContext } from "@/context/KeyContext";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, ShieldAlert, KeyRound, Lock, Eye, EyeOff } from "lucide-react";

interface SignupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToLogin: () => void;
}

export function SignupModal({ isOpen, onClose, onSwitchToLogin }: SignupModalProps) {
  const { prepareSignup, completeSignup } = useKeyContext();

  const [step, setStep] = useState<"input" | "recovery">("input");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [recoveryCode, setRecoveryCode] = useState("");
  const [hasSavedCode, setHasSavedCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleInitialSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password || !secretKey) {
      setError("All fields are required.");
      return;
    }

    if (password.length < 8) {
      setError("Login password must be at least 8 characters.");
      return;
    }

    if (secretKey.length < 8) {
      setError("Secret Key must be at least 8 characters.");
      return;
    }

    if (password === secretKey) {
      setError("Security requirement: Login password and Secret Key must be distinct (Rule 3).");
      return;
    }

    setIsSubmitting(true);
    try {
      const code = await prepareSignup(email, password, secretKey);
      setRecoveryCode(code);
      setStep("recovery");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize cryptography.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard write failed
    }
  };

  const handleFinalSignup = async () => {
    if (!hasSavedCode) {
      setError("You must confirm you have saved your recovery code.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await completeSignup(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg border-border bg-card shadow-2xl text-foreground">
        {step === "input" ? (
          <form onSubmit={handleInitialSubmit}>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-trend-green" />
                <span className="text-xs font-mono uppercase text-muted-foreground">
                  Zero-Knowledge Registration
                </span>
              </div>
              <CardTitle className="text-xl font-bold">Create Encrypted Account</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Your data is encrypted before leaving your browser. The server never sees your
                plaintext financial records or secret key.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@domain.com"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Login Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters (authenticates with server)"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Used solely to log in to the server. Never used to encrypt your financial data.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-gridline">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-foreground" />
                    Separate "Secret Key" (Master Encryption Passphrase)
                  </label>
                </div>
                <div className="relative">
                  <input
                    type={showSecretKey ? "text" : "password"}
                    required
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="Unique phrase (never transmitted to server)"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="p-2.5 rounded bg-nav-active/40 border border-border text-[11px] text-muted-foreground space-y-1">
                  <span className="font-semibold text-foreground">Rule 2 & 3:</span> Derived keys
                  live in browser memory only. The server and database never receive this Secret
                  Key.
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Generating Cryptographic Keys..." : "Next: Generate Recovery Code"}
              </Button>
              <div className="text-center text-xs text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={onSwitchToLogin}
                  className="text-foreground hover:underline font-medium"
                >
                  Log In
                </button>
              </div>
            </CardFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2 text-trend-red">
                <ShieldAlert className="h-5 w-5" />
                <CardTitle className="text-lg font-bold text-foreground">
                  Save Your Recovery Code (One-Time Display)
                </CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                This recovery code can unlock your vault if you ever forget your Secret Key. We do
                not store it and cannot reset it.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                  {error}
                </div>
              )}

              {/* Warning Callout */}
              <div className="rounded-lg border border-trend-red/30 bg-trend-red/10 p-3 text-xs text-trend-red space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" />
                  CRITICAL ZERO-KNOWLEDGE WARNING:
                </div>
                <div>
                  Lost Secret Key + Lost Recovery Code = <strong>Permanent Data Loss</strong>.
                  Neither the server nor system administrators can recover your account or decrypt
                  bank statements.
                </div>
              </div>

              {/* Recovery Code Display */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase text-muted-foreground">
                  Your Master Recovery Code
                </label>
                <div className="p-3 rounded-lg border border-border bg-background font-mono text-xs sm:text-sm text-foreground break-all select-all flex items-center justify-between gap-2">
                  <span>{recoveryCode}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleCopyCode}
                    className="shrink-0 gap-1.5"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-trend-green" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              {/* Mandatory Acknowledgment Checkbox */}
              <label className="flex items-start gap-3 p-3 rounded border border-border bg-nav-active/20 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasSavedCode}
                  onChange={(e) => setHasSavedCode(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border bg-background text-foreground focus:ring-ring"
                />
                <span className="text-xs text-foreground leading-snug">
                  <strong>I have safely saved this Recovery Code.</strong> I understand that my
                  Secret Key is never sent to the server and that lost key = lost data.
                </span>
              </label>
            </CardContent>

            <CardFooter className="flex flex-col gap-2">
              <Button
                type="button"
                disabled={!hasSavedCode || isSubmitting}
                onClick={handleFinalSignup}
                className="w-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
              >
                {isSubmitting
                  ? "Finalizing Zero-Knowledge Registration..."
                  : "Complete Registration & Open Vault"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep("input")}
                disabled={isSubmitting}
                className="text-xs text-muted-foreground"
              >
                Back to credentials
              </Button>
            </CardFooter>
          </div>
        )}
      </Card>
    </div>
  );
}
