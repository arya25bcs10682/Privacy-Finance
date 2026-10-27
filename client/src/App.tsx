import { BrowserRouter, Routes, Route } from "react-router-dom";
import { KeyProvider } from "@/context/KeyContext";
import { TransactionProvider } from "@/context/TransactionContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { BudgetsPage } from "@/pages/BudgetsPage";
import { BillsPage } from "@/pages/BillsPage";
import { InvestmentsPage } from "@/pages/InvestmentsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UploadPage } from "@/pages/UploadPage";

export default function App() {
  return (
    <BrowserRouter>
      <KeyProvider>
        <TransactionProvider>
          <AppLayout>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/budgets" element={<BudgetsPage />} />
              <Route path="/bills" element={<BillsPage />} />
              <Route path="/investments" element={<InvestmentsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/upload" element={<UploadPage />} />
            </Routes>
          </AppLayout>
        </TransactionProvider>
      </KeyProvider>
    </BrowserRouter>
  );
}
