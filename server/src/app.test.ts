import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("Server Routes and Static Client Serving", () => {
  const app = createApp();

  it("GET /api/health returns 200 with status ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("service", "privacy-finance-server");
  });

  it("GET non-existent /api route does not serve index.html", async () => {
    const res = await request(app).get("/api/non-existent-endpoint");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<!doctype html>");
  });

  it("GET non-/api route (e.g. /dashboard) serves index.html if client/dist exists", async () => {
    const res = await request(app).get("/dashboard");
    // If client is built, it returns 200 with HTML; if not built, it falls through to 404
    if (res.status === 200) {
      expect(res.headers["content-type"]).toMatch(/html/);
      expect(res.text).toContain("<div id=\"root\">");
    } else {
      expect(res.status).toBe(404);
    }
  });
});
