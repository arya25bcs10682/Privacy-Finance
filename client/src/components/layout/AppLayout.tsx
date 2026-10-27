import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { LoginForm } from "@/components/auth/LoginForm";
import { SignupModal } from "@/components/auth/SignupModal";
import { LockScreen } from "@/components/auth/LockScreen";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isSignupOpen, setIsSignupOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black text-foreground flex flex-col antialiased">
      {/* Left Sidebar (Desktop Fixed + Mobile Drawer) */}
      <Sidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      {/* Top Fixed Header */}
      <Header
        onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
        onOpenLogin={() => setIsLoginOpen(true)}
        onOpenSignup={() => setIsSignupOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 pt-14 flex flex-col">
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Auth Modals & In-Memory Lock Screen */}
      <LoginForm
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSwitchToSignup={() => {
          setIsLoginOpen(false);
          setIsSignupOpen(true);
        }}
      />

      <SignupModal
        isOpen={isSignupOpen}
        onClose={() => setIsSignupOpen(false)}
        onSwitchToLogin={() => {
          setIsSignupOpen(false);
          setIsLoginOpen(true);
        }}
      />

      {!isLoginOpen && !isSignupOpen && <LockScreen />}
    </div>
  );
}
