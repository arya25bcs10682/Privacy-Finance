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
import { Lock, KeyRound, LogOut, Eye, EyeOff, LifeBuoy } from "lucide-react";

export function LockScreen() {
  const { user, isLocked, unlock, unlockWithRecovery, logout } = useKeyContext();

  const [secretKey, setSecretKey] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only show if user is authenticated and app is locked
  if (!user || !isLocked) return null;

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (useRecovery) {
        await unlockWithRecovery(recoveryCode);
      } else {
        await unlock(secretKey);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <Card className="w-full max-w-md border-border bg-card shadow-2xl text-foreground">
        <form onSubmit={handleUnlock}>
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-nav-active border border-border">
              <Lock className="h-6 w-6 text-foreground" />
            </div>
            <CardTitle className="text-xl font-bold">Vault Locked</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Locked due to inactivity or new session for{" "}
              <strong className="text-foreground">{user.email}</strong>. Keys were wiped from memory
              per zero-knowledge rules.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 text-xs bg-trend-red/10 border border-trend-red/30 text-trend-red rounded">
                {error}
              </div>
            )}

            {!useRecovery ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" />
                  Enter Secret Key to Resume
                </label>
                <div className="relative">
                  <input
                    type={showSecretKey ? "text" : "password"}
                    required
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    placeholder="Your secret passphrase"
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
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5 text-trend-green">
                  <LifeBuoy className="h-3.5 w-3.5" />
                  Enter Recovery Code
                </label>
                <input
                  type="text"
                  required
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="RC-XXXX-XXXX-XXXX-..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                />
              </div>
            )}

            <div className="flex justify-between items-center text-xs">
              <button
                type="button"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setError(null);
                }}
                className="text-muted-foreground hover:text-foreground underline underline-offset-4"
              >
                {useRecovery ? "Use Secret Key" : "Use Recovery Code"}
              </button>

              <button
                type="button"
                onClick={logout}
                className="text-muted-foreground hover:text-trend-red flex items-center gap-1"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Decrypting Vault Keys..." : "Unlock Vault"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
