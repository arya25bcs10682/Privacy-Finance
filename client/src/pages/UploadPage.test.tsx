import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { UploadPage } from "./UploadPage";
import { KeyProvider } from "@/context/KeyContext";

describe("UploadPage Component", () => {
  it("renders locked state when user has not unlocked vault", () => {
    render(
      <BrowserRouter>
        <KeyProvider>
          <UploadPage />
        </KeyProvider>
      </BrowserRouter>
    );

    expect(screen.getByText(/Vault is Locked/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to Dashboard to Unlock/i)).toBeInTheDocument();
  });
});
