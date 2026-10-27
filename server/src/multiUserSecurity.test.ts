import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { generateTokens } from "./utils/jwt.js";

// In-Memory store simulating MongoDB collections for multi-user isolation tests
interface StoredDoc {
  _id: string;
  userId: string;
  [key: string]: unknown;
}

const dbStore = {
  transactions: [] as StoredDoc[],
  accounts: [] as StoredDoc[],
  budgets: [] as StoredDoc[],
  bills: [] as StoredDoc[],
  holdings: [] as StoredDoc[],
  statementFiles: [] as StoredDoc[],
};

interface BulkOp {
  updateOne: {
    filter: Record<string, unknown>;
    update: { $setOnInsert: Record<string, unknown> };
    upsert?: boolean;
  };
}

function createMockModel(collectionKey: keyof typeof dbStore) {
  const Model = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    const doc: StoredDoc = {
      _id: `id-${Math.random().toString(36).substring(2, 9)}`,
      ...data,
      userId: data.userId as string,
    };
    return {
      ...doc,
      save: vi.fn().mockImplementation(async () => {
        dbStore[collectionKey].push(doc);
        return doc;
      }),
    };
  }) as unknown as {
    new (data: Record<string, unknown>): StoredDoc;
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    findOneAndUpdate: ReturnType<typeof vi.fn>;
    findOneAndDelete: ReturnType<typeof vi.fn>;
    bulkWrite: ReturnType<typeof vi.fn>;
  };

  Model.find = vi.fn().mockImplementation((query: Record<string, unknown>) => {
    return {
      sort: vi.fn().mockImplementation(() => {
        return dbStore[collectionKey].filter((doc) => {
          return Object.entries(query).every(([k, v]) => {
            if (v && typeof v === "object" && "$in" in (v as Record<string, unknown>)) {
              const inArr = (v as { $in: unknown[] }).$in;
              return inArr.includes(doc[k]);
            }
            return doc[k] === v;
          });
        });
      }),
    };
  });

  Model.findOne = vi.fn().mockImplementation((query: Record<string, unknown>) => {
    const found = dbStore[collectionKey].find((doc) => {
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
    return found || null;
  });

  Model.findOneAndUpdate = vi
    .fn()
    .mockImplementation(
      (query: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        const idx = dbStore[collectionKey].findIndex((doc) => {
          return Object.entries(query).every(([k, v]) => doc[k] === v);
        });
        if (idx === -1) return null;
        dbStore[collectionKey][idx] = {
          ...dbStore[collectionKey][idx],
          ...update.$set,
        };
        return dbStore[collectionKey][idx];
      }
    );

  Model.findOneAndDelete = vi.fn().mockImplementation((query: Record<string, unknown>) => {
    const idx = dbStore[collectionKey].findIndex((doc) => {
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
    if (idx === -1) return null;
    const removed = dbStore[collectionKey].splice(idx, 1)[0];
    return removed;
  });

  Model.bulkWrite = vi.fn().mockImplementation(async (operations: BulkOp[]) => {
    let insertedCount = 0;
    let matchedCount = 0;

    for (const op of operations) {
      const { filter, update, upsert } = op.updateOne;
      const existing = dbStore[collectionKey].find((d) => {
        return Object.entries(filter).every(([k, v]) => d[k] === v);
      });

      if (existing) {
        matchedCount++;
      } else if (upsert) {
        insertedCount++;
        dbStore[collectionKey].push({
          _id: `bulk-${Math.random().toString(36).substring(2, 9)}`,
          ...update.$setOnInsert,
        });
      }
    }

    return { upsertedCount: insertedCount, matchedCount };
  });

  return Model;
}

vi.mock("./models/Transaction.js", () => ({ Transaction: createMockModel("transactions") }));
vi.mock("./models/Account.js", () => ({ Account: createMockModel("accounts") }));
vi.mock("./models/Budget.js", () => ({ Budget: createMockModel("budgets") }));
vi.mock("./models/Bill.js", () => ({ Bill: createMockModel("bills") }));
vi.mock("./models/Holding.js", () => ({ Holding: createMockModel("holdings") }));
vi.mock("./models/StatementFile.js", () => ({ StatementFile: createMockModel("statementFiles") }));

describe("Multi-User Isolation & Security Tests", () => {
  const app = createApp();

  const userAId = "user_A_60d0fe4f5311236168a109ca";
  const userBId = "user_B_70e1ff5f6422347279b210db";

  let userAToken: string;
  let userBToken: string;

  beforeEach(() => {
    dbStore.transactions = [];
    dbStore.accounts = [];
    dbStore.budgets = [];
    dbStore.bills = [];
    dbStore.holdings = [];
    dbStore.statementFiles = [];

    userAToken = generateTokens(userAId).accessToken;
    userBToken = generateTokens(userBId).accessToken;
  });

  describe("1. User A CANNOT READ User B's Documents", () => {
    it("returns 404 when User A requests User B's single transaction by ID", async () => {
      // Seed a transaction belonging strictly to User B
      const userBTxId = "tx_user_b_001";
      dbStore.transactions.push({
        _id: userBTxId,
        userId: userBId,
        txHash: "hash-user-b-1",
        month: "2026-02",
        encryptedPayload: { iv: "iv-b", ct: "ct-b" },
      });

      // User A attempts to read User B's transaction
      const res = await request(app)
        .get(`/api/transactions/${userBTxId}`)
        .set("Cookie", [`accessToken=${userAToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Transaction not found.");
    });

    it("ensures User A listing transactions NEVER sees User B's transactions", async () => {
      // Seed transactions for User A and User B
      dbStore.transactions.push(
        {
          _id: "tx-a-1",
          userId: userAId,
          txHash: "hash-a-1",
          month: "2026-02",
          encryptedPayload: { iv: "iv-a", ct: "ct-a" },
        },
        {
          _id: "tx-b-1",
          userId: userBId,
          txHash: "hash-b-1",
          month: "2026-02",
          encryptedPayload: { iv: "iv-b", ct: "ct-b" },
        }
      );

      const res = await request(app)
        .get("/api/transactions")
        .set("Cookie", [`accessToken=${userAToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.transactions.length).toBe(1);
      expect(res.body.transactions[0]._id).toBe("tx-a-1");
      expect(res.body.transactions[0].userId).toBe(userAId);
    });

    it("returns 404 when User A requests User B's account, budget, bill, holding, or statement file", async () => {
      dbStore.accounts.push({
        _id: "acc-b",
        userId: userBId,
        encryptedPayload: { iv: "1", ct: "2" },
      });
      dbStore.budgets.push({
        _id: "bud-b",
        userId: userBId,
        month: "2026-02",
        encryptedPayload: { iv: "1", ct: "2" },
      });
      dbStore.bills.push({
        _id: "bill-b",
        userId: userBId,
        encryptedPayload: { iv: "1", ct: "2" },
      });
      dbStore.holdings.push({
        _id: "hold-b",
        userId: userBId,
        encryptedPayload: { iv: "1", ct: "2" },
      });
      dbStore.statementFiles.push({
        _id: "stmt-b",
        userId: userBId,
        encryptedPayload: { iv: "1", ct: "2" },
      });

      const endpoints = [
        `/api/accounts/acc-b`,
        `/api/budgets/bud-b`,
        `/api/bills/bill-b`,
        `/api/holdings/hold-b`,
        `/api/statement-files/stmt-b`,
      ];

      for (const endpoint of endpoints) {
        const res = await request(app)
          .get(endpoint)
          .set("Cookie", [`accessToken=${userAToken}`]);
        expect(res.status).toBe(404);
      }
    });
  });

  describe("2. User A CANNOT UPDATE User B's Documents", () => {
    it("returns 404 and does NOT modify User B's transaction when User A sends a PUT", async () => {
      const userBTxId = "tx_user_b_secure";
      const originalPayload = { iv: "original-iv-b", ct: "original-ct-b" };

      dbStore.transactions.push({
        _id: userBTxId,
        userId: userBId,
        txHash: "hash-b-protected",
        month: "2026-02",
        encryptedPayload: originalPayload,
      });

      // User A attempts to overwrite User B's transaction
      const res = await request(app)
        .put(`/api/transactions/${userBTxId}`)
        .set("Cookie", [`accessToken=${userAToken}`])
        .send({
          encryptedPayload: { iv: "hacked-iv", ct: "hacked-ct" },
          month: "2099-12",
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Transaction not found.");

      // Verify User B's document in the database was NOT altered
      const docInDb = dbStore.transactions.find((t) => t._id === userBTxId);
      expect(docInDb?.encryptedPayload).toEqual(originalPayload);
      expect(docInDb?.month).toBe("2026-02");
    });
  });

  describe("3. User A CANNOT DELETE User B's Documents", () => {
    it("returns 404 and does NOT delete User B's transaction when User A sends a DELETE", async () => {
      const userBTxId = "tx_user_b_cannot_delete";
      dbStore.transactions.push({
        _id: userBTxId,
        userId: userBId,
        txHash: "hash-b-cannot-delete",
        month: "2026-02",
        encryptedPayload: { iv: "b", ct: "b" },
      });

      // User A attempts to delete User B's transaction
      const res = await request(app)
        .delete(`/api/transactions/${userBTxId}`)
        .set("Cookie", [`accessToken=${userAToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Transaction not found.");

      // Verify document still exists safely in database
      const docInDb = dbStore.transactions.find((t) => t._id === userBTxId);
      expect(docInDb).toBeDefined();
    });
  });

  describe("4. Bulk Insert with Duplicate Skipping on (userId, txHash)", () => {
    it("skips duplicates for the same user and returns accurate insertedCount and skippedCount", async () => {
      // Pre-seed an existing transaction for User A
      dbStore.transactions.push({
        _id: "tx-existing-1",
        userId: userAId,
        txHash: "hash-alpha",
        month: "2026-02",
        encryptedPayload: { iv: "old-iv", ct: "old-ct" },
      });

      // User A sends 3 transactions: 1 duplicate (hash-alpha) and 2 new (hash-beta, hash-gamma)
      const res = await request(app)
        .post("/api/transactions/bulk")
        .set("Cookie", [`accessToken=${userAToken}`])
        .send({
          transactions: [
            { txHash: "hash-alpha", month: "2026-02", encryptedPayload: { iv: "1", ct: "1" } },
            { txHash: "hash-beta", month: "2026-02", encryptedPayload: { iv: "2", ct: "2" } },
            { txHash: "hash-gamma", month: "2026-02", encryptedPayload: { iv: "3", ct: "3" } },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.insertedCount).toBe(2);
      expect(res.body.skippedCount).toBe(1);
      expect(res.body.total).toBe(3);
      expect(res.body.success).toBe(true);

      // Verify db collection size for User A is 3
      const userATransactions = dbStore.transactions.filter((t) => t.userId === userAId);
      expect(userATransactions.length).toBe(3);
    });

    it("allows User B to insert the same txHash that User A already has (unique per user)", async () => {
      // User A has hash-shared
      dbStore.transactions.push({
        _id: "tx-a-shared",
        userId: userAId,
        txHash: "hash-shared",
        month: "2026-02",
        encryptedPayload: { iv: "a", ct: "a" },
      });

      // User B inserts the identical txHash (e.g. identical statement item on their own account)
      const res = await request(app)
        .post("/api/transactions/bulk")
        .set("Cookie", [`accessToken=${userBToken}`])
        .send({
          transactions: [
            { txHash: "hash-shared", month: "2026-02", encryptedPayload: { iv: "b", ct: "b" } },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.insertedCount).toBe(1);
      expect(res.body.skippedCount).toBe(0);

      // Both users have their own independent copy with txHash: hash-shared
      expect(dbStore.transactions.filter((t) => t.txHash === "hash-shared").length).toBe(2);
    });

    it("checks hashes and correctly reports existing duplicate hashes vs new hashes", async () => {
      // User A already has hash-1 and hash-2
      dbStore.transactions.push(
        {
          _id: "tx-a-1",
          userId: userAId,
          txHash: "hash-existing-1",
          month: "2026-01",
          encryptedPayload: { iv: "1", ct: "1" },
        },
        {
          _id: "tx-a-2",
          userId: userAId,
          txHash: "hash-existing-2",
          month: "2026-01",
          encryptedPayload: { iv: "2", ct: "2" },
        }
      );

      // User A checks 3 candidate hashes: hash-existing-1 (duplicate), hash-new-3 (new), hash-new-4 (new)
      const resA = await request(app)
        .post("/api/transactions/check-hashes")
        .set("Cookie", [`accessToken=${userAToken}`])
        .send({
          txHashes: ["hash-existing-1", "hash-new-3", "hash-new-4"],
        });

      expect(resA.status).toBe(200);
      expect(resA.body.duplicateCount).toBe(1);
      expect(resA.body.newCount).toBe(2);
      expect(resA.body.existingHashes).toEqual(["hash-existing-1"]);

      // User B checks the same hashes - since User B doesn't own hash-existing-1, all are reported as new for User B
      const resB = await request(app)
        .post("/api/transactions/check-hashes")
        .set("Cookie", [`accessToken=${userBToken}`])
        .send({
          txHashes: ["hash-existing-1", "hash-new-3", "hash-new-4"],
        });

      expect(resB.status).toBe(200);
      expect(resB.body.duplicateCount).toBe(0);
      expect(resB.body.newCount).toBe(3);
      expect(resB.body.existingHashes).toEqual([]);
    });
  });
});

