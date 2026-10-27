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
import { KeyRound, ShieldCheck, Eye, EyeOff, LifeBuoy } from "lucide-react";

interface LoginFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToSignup: () => void;
}

export function LoginForm({ isOpen, onClose, onSwitchToSignup }: LoginFormProps) {
  const { login, unlock, unlockWithRecovery, user, isLocked } = useKeyContext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const [useRecoveryMode, setUseRecoveryMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Step 1: Email & Password
  const handlePasswordLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      // On success, isLocked becomes true and prompts for Secret Key
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Unlock with Secret Key
  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (useRecoveryMode) {
        await unlockWithRecovery(recoveryCode);
      } else {
        await unlock(secretKey);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decryption failed. Invalid key.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md border-border bg-card shadow-2xl text-foreground">
        {!user || !isLocked ? (
          // Step 1: Password Login
          <form onSubmit={handlePasswordLogin}>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-foreground" />
                <span className="text-xs font-mono uppercase text-muted-foreground">
                  Step 1 of 2
                </span>
              </div>
              <CardTitle className="text-xl font-bold">Log In to Account</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Authenticate with your email and server password.
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
                    placeholder="Password"
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
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Authenticating..." : "Continue to Vault Decryption"}
              </Button>
              <div className="text-center text-xs text-muted-foreground">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={onSwitchToSignup}
                  className="text-foreground hover:underline font-medium"
                >
                  Create Account
                </button>
              </div>
            </CardFooter>
          </form>
        ) : (
          // Step 2: In-Memory Secret Key Decryption
          <form onSubmit={handleUnlock}>
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-trend-green" />
                <span className="text-xs font-mono uppercase text-trend-green">
                  Step 2: Zero-Knowledge Unlock
                </span>
              </div>
              <CardTitle className="text-xl font-bold">Enter Secret Key</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Logged in as <strong className="text-foreground">{user.email}</strong>. Enter your
                Secret Key to unwrap your encryption keys in browser memory.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                  {error}
                </div>
              )}

              {!useRecoveryMode ? (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    Secret Key
                  </label>
                  <div className="relative">
                    <input
                      type={showSecretKey ? "text" : "password"}
                      required
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      placeholder="Your client-side secret key"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecretKey(!showSecretKey)}
                      className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    This key never touches the server. Derived keys live only in browser memory
                    until logout or 15 minutes idle.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground flex items-center gap-1.5 text-trend-green">
                    <LifeBuoy className="h-3.5 w-3.5" />
                    Master Recovery Code
                  </label>
                  <input
                    type="text"
                    required
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    placeholder="RC-XXXX-XXXX-XXXX-..."
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Paste the recovery code displayed during initial registration.
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setUseRecoveryMode(!useRecoveryMode);
                    setError(null);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
                >
                  {useRecoveryMode
                    ? "Use Secret Key instead"
                    : "Forgot Secret Key? Use Recovery Code"}
                </button>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-2 pt-2">
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Decrypting Master Vault..." : "Unlock Vault"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
