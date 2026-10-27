import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { User } from "./models/User.js";
import bcrypt from "bcryptjs";

// Mock User model methods
vi.mock("./models/User.js", () => {
  const mockUserInstance = {
    _id: "60d0fe4f5311236168a109ca",
    email: "test@example.com",
    passwordHash: "",
    keySalt: "salt-abc-123",
    wrappedDataKey: { ciphertext: "wrapped-key-ciphertext" },
    wrappedDataKeyByRecovery: { ciphertext: "recovery-key-ciphertext" },
    refreshTokens: [] as string[],
    save: vi.fn().mockResolvedValue(true),
  };

  const MockUserModel = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    return {
      ...mockUserInstance,
      ...data,
      save: vi.fn().mockResolvedValue(true),
    };
  }) as unknown as {
    new (data: Record<string, unknown>): typeof mockUserInstance;
    findOne: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findByIdAndUpdate: ReturnType<typeof vi.fn>;
  };

  MockUserModel.findOne = vi.fn();
  MockUserModel.findById = vi.fn();
  MockUserModel.findByIdAndUpdate = vi.fn();

  return { User: MockUserModel };
});

const mockedUser = User as unknown as {
  findOne: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
  findByIdAndUpdate: ReturnType<typeof vi.fn>;
};

describe("Auth Endpoints", () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/signup", () => {
    const validSignupData = {
      email: "test@example.com",
      password: "securepassword123",
      keySalt: "salt-base64-random",
      wrappedDataKey: { ciphertext: "ciphertext-data-key" },
      wrappedDataKeyByRecovery: { ciphertext: "ciphertext-recovery-key" },
    };

    it("rejects signup with 400 if client attempts to send raw secretKey", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          ...validSignupData,
          secretKey: "ILLEGAL_LEAKED_SECRET",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Secret key must never be transmitted");
    });

    it("creates a new user, returns JWT token in JSON body, and sets httpOnly cookies", async () => {
      mockedUser.findOne.mockResolvedValue(null);

      const res = await request(app).post("/api/auth/signup").send(validSignupData);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(typeof res.body.token).toBe("string");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.email).toBe(validSignupData.email);
      expect(res.body.keySalt).toBe(validSignupData.keySalt);
      expect(res.body.wrappedDataKey).toEqual(validSignupData.wrappedDataKey);

      // Verify cookies
      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.includes("accessToken") && c.includes("HttpOnly"))).toBe(
        true
      );
      expect(
        cookies.some((c: string) => c.includes("refreshToken") && c.includes("HttpOnly"))
      ).toBe(true);
    });

    it("returns 409 if user email already exists", async () => {
      mockedUser.findOne.mockResolvedValue({ email: "test@example.com" });

      const res = await request(app).post("/api/auth/signup").send(validSignupData);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already exists");
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns token in body, user, keySalt, and wrapped keys on valid credentials", async () => {
      const passwordHash = await bcrypt.hash("validpassword123", 10);
      mockedUser.findOne.mockResolvedValue({
        _id: "60d0fe4f5311236168a109ca",
        email: "test@example.com",
        passwordHash,
        keySalt: "stored-salt",
        wrappedDataKey: { ciphertext: "stored-wrapped-data-key" },
        wrappedDataKeyByRecovery: { ciphertext: "stored-recovery-key" },
        refreshTokens: [],
        save: vi.fn().mockResolvedValue(true),
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "validpassword123",
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("token");
      expect(typeof res.body.token).toBe("string");
      expect(res.body.keySalt).toBe("stored-salt");
      expect(res.body.wrappedDataKey).toBeDefined();

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.includes("accessToken"))).toBe(true);
    });

    it("returns 401 on invalid password", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      mockedUser.findOne.mockResolvedValue({
        email: "test@example.com",
        passwordHash,
      });

      const res = await request(app).post("/api/auth/login").send({
        email: "test@example.com",
        password: "wrong-password",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid email or password.");
    });
  });

  describe("Bearer Token Authentication via requireAuth", () => {
    it("authenticates GET /api/auth/me using Authorization: Bearer <token>", async () => {
      const passwordHash = await bcrypt.hash("testpass123", 10);
      const fakeUser = {
        _id: "60d0fe4f5311236168a109ca",
        email: "bearer@example.com",
        passwordHash,
        keySalt: "salt123",
        wrappedDataKey: { ct: "abc" },
        wrappedDataKeyByRecovery: "def",
        refreshTokens: [],
        save: vi.fn().mockResolvedValue(true),
      };
      mockedUser.findOne.mockResolvedValue(fakeUser);
      mockedUser.findById.mockResolvedValue(fakeUser);

      // Login to get token
      const loginRes = await request(app).post("/api/auth/login").send({
        email: "bearer@example.com",
        password: "testpass123",
      });
      const token = loginRes.body.token;
      expect(token).toBeDefined();

      // Access /api/auth/me with Bearer token header and NO cookies
      const meRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe("bearer@example.com");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears cookies on logout", async () => {
      const res = await request(app).post("/api/auth/logout");
      expect(res.status).toBe(200);

      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.includes("accessToken=;"))).toBe(true);
    });
  });

  describe("GET /api/auth/rules and PUT /api/auth/rules", () => {
    it("returns 401 when accessing rules without authentication", async () => {
      const getRes = await request(app).get("/api/auth/rules");
      expect(getRes.status).toBe(401);

      const putRes = await request(app).put("/api/auth/rules").send({
        encryptedRules: { iv: "iv-123", ct: "ct-123" },
      });
      expect(putRes.status).toBe(401);
    });
  });
});
