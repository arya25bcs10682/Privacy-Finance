import mongoose from "mongoose";

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1 || process.env.VITEST === "true";
}

export interface InMemoryUser {
  _id: string;
  email: string;
  passwordHash: string;
  keySalt: string;
  wrappedDataKey: { ciphertext: string; iv?: string };
  wrappedDataKeyByRecovery: { ciphertext: string; iv?: string } | string;
  refreshTokens: string[];
  encryptedMappings?: { ciphertext: string; iv: string; authTag: string };
  encryptedRules?: { ciphertext: string; iv: string; authTag: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryTransaction {
  _id: string;
  userId: string;
  txHash: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  month: string;
  accountId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryBudget {
  _id: string;
  userId: string;
  month: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryBill {
  _id: string;
  userId: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  dueDateMonth?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryHolding {
  _id: string;
  userId: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  assetClass?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryAccount {
  _id: string;
  userId: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  accountType?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InMemoryStatementFile {
  _id: string;
  userId: string;
  encryptedPayload: { ciphertext: string; iv: string; authTag: string };
  bank?: string;
  month?: string;
  gridFsFileId?: string;
  fileSize?: number;
  createdAt: Date;
  updatedAt: Date;
}

const usersMap = new Map<string, InMemoryUser>();
const transactionsMap = new Map<string, InMemoryTransaction>();
const budgetsMap = new Map<string, InMemoryBudget>();
const billsMap = new Map<string, InMemoryBill>();
const holdingsMap = new Map<string, InMemoryHolding>();
const accountsMap = new Map<string, InMemoryAccount>();
const statementFilesMap = new Map<string, InMemoryStatementFile>();

export const memoryStore = {
  users: {
    findByEmail(email: string): InMemoryUser | null {
      const lower = email.toLowerCase().trim();
      for (const u of usersMap.values()) {
        if (u.email === lower) return u;
      }
      return null;
    },
    findById(id: string): InMemoryUser | null {
      return usersMap.get(id) || null;
    },
    findByRefreshToken(token: string): InMemoryUser | null {
      for (const u of usersMap.values()) {
        if (u.refreshTokens.includes(token)) return u;
      }
      return null;
    },
    create(data: Omit<InMemoryUser, "_id" | "createdAt" | "updatedAt">): InMemoryUser {
      const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const user: InMemoryUser = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      usersMap.set(id, user);
      return user;
    },
    save(user: InMemoryUser): InMemoryUser {
      user.updatedAt = new Date();
      usersMap.set(user._id, user);
      return user;
    },
  },

  transactions: {
    find(userId: string, filter?: { month?: string; accountId?: string }): InMemoryTransaction[] {
      return Array.from(transactionsMap.values())
        .filter((t) => {
          if (t.userId !== userId) return false;
          if (filter?.month && t.month !== filter.month) return false;
          if (filter?.accountId && t.accountId !== filter.accountId) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findById(id: string, userId: string): InMemoryTransaction | null {
      const t = transactionsMap.get(id);
      if (t && t.userId === userId) return t;
      return null;
    },
    checkHashes(userId: string, txHashes: string[]): { existingHashes: string[]; duplicateCount: number; newCount: number } {
      const existingHashes: string[] = [];
      for (const t of transactionsMap.values()) {
        if (t.userId === userId && txHashes.includes(t.txHash)) {
          existingHashes.push(t.txHash);
        }
      }
      return {
        existingHashes,
        duplicateCount: existingHashes.length,
        newCount: txHashes.length - existingHashes.length,
      };
    },
    bulkUpsert(
      userId: string,
      txs: Array<{
        txHash: string;
        encryptedPayload: { ciphertext: string; iv: string; authTag: string };
        month: string;
        accountId?: string;
      }>
    ): { insertedCount: number; skippedCount: number; total: number } {
      let insertedCount = 0;
      let skippedCount = 0;
      for (const tx of txs) {
        const exists = Array.from(transactionsMap.values()).some(
          (item) => item.userId === userId && item.txHash === tx.txHash
        );
        if (exists) {
          skippedCount++;
        } else {
          const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          transactionsMap.set(id, {
            _id: id,
            userId,
            txHash: tx.txHash,
            encryptedPayload: tx.encryptedPayload,
            month: tx.month,
            accountId: tx.accountId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          insertedCount++;
        }
      }
      return {
        insertedCount,
        skippedCount,
        total: txs.length,
      };
    },
    create(data: Omit<InMemoryTransaction, "_id" | "createdAt" | "updatedAt">): InMemoryTransaction {
      const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tx: InMemoryTransaction = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      transactionsMap.set(id, tx);
      return tx;
    },
    delete(id: string, userId: string): boolean {
      const tx = transactionsMap.get(id);
      if (tx && tx.userId === userId) {
        transactionsMap.delete(id);
        return true;
      }
      return false;
    },
  },

  budgets: {
    find(userId: string, month?: string): InMemoryBudget[] {
      return Array.from(budgetsMap.values()).filter(
        (b) => b.userId === userId && (!month || b.month === month)
      );
    },
    findById(id: string | string[], userId: string): InMemoryBudget | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = budgetsMap.get(idStr);
      return b && b.userId === userId ? b : null;
    },
    create(data: Omit<InMemoryBudget, "_id" | "createdAt" | "updatedAt">): InMemoryBudget {
      const id = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const b: InMemoryBudget = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      budgetsMap.set(id, b);
      return b;
    },
    update(
      id: string | string[],
      userId: string,
      payload?: InMemoryBudget["encryptedPayload"],
      month?: string
    ): InMemoryBudget | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = budgetsMap.get(idStr);
      if (!b || b.userId !== userId) return null;
      if (payload) b.encryptedPayload = payload;
      if (month) b.month = month;
      b.updatedAt = new Date();
      return b;
    },
    delete(id: string | string[], userId: string): boolean {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = budgetsMap.get(idStr);
      if (b && b.userId === userId) {
        budgetsMap.delete(idStr);
        return true;
      }
      return false;
    },
  },

  bills: {
    find(userId: string, dueDateMonth?: string): InMemoryBill[] {
      return Array.from(billsMap.values())
        .filter((b) => b.userId === userId && (!dueDateMonth || b.dueDateMonth === dueDateMonth))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findById(id: string | string[], userId: string): InMemoryBill | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = billsMap.get(idStr);
      return b && b.userId === userId ? b : null;
    },
    create(data: Omit<InMemoryBill, "_id" | "createdAt" | "updatedAt">): InMemoryBill {
      const id = `bl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const b: InMemoryBill = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      billsMap.set(id, b);
      return b;
    },
    update(
      id: string | string[],
      userId: string,
      payload?: InMemoryBill["encryptedPayload"],
      dueDateMonth?: string
    ): InMemoryBill | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = billsMap.get(idStr);
      if (!b || b.userId !== userId) return null;
      if (payload) b.encryptedPayload = payload;
      if (dueDateMonth !== undefined) b.dueDateMonth = dueDateMonth;
      b.updatedAt = new Date();
      return b;
    },
    delete(id: string | string[], userId: string): boolean {
      const idStr = Array.isArray(id) ? id[0] : id;
      const b = billsMap.get(idStr);
      if (b && b.userId === userId) {
        billsMap.delete(idStr);
        return true;
      }
      return false;
    },
  },

  holdings: {
    find(userId: string, assetClass?: string): InMemoryHolding[] {
      return Array.from(holdingsMap.values())
        .filter((h) => h.userId === userId && (!assetClass || h.assetClass === assetClass))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findById(id: string | string[], userId: string): InMemoryHolding | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const h = holdingsMap.get(idStr);
      return h && h.userId === userId ? h : null;
    },
    create(data: Omit<InMemoryHolding, "_id" | "createdAt" | "updatedAt">): InMemoryHolding {
      const id = `hd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const h: InMemoryHolding = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      holdingsMap.set(id, h);
      return h;
    },
    update(
      id: string | string[],
      userId: string,
      payload?: InMemoryHolding["encryptedPayload"],
      assetClass?: string
    ): InMemoryHolding | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const h = holdingsMap.get(idStr);
      if (!h || h.userId !== userId) return null;
      if (payload) h.encryptedPayload = payload;
      if (assetClass !== undefined) h.assetClass = assetClass;
      h.updatedAt = new Date();
      return h;
    },
    delete(id: string | string[], userId: string): boolean {
      const idStr = Array.isArray(id) ? id[0] : id;
      const h = holdingsMap.get(idStr);
      if (h && h.userId === userId) {
        holdingsMap.delete(idStr);
        return true;
      }
      return false;
    },
  },

  accounts: {
    find(userId: string): InMemoryAccount[] {
      return Array.from(accountsMap.values())
        .filter((a) => a.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findById(id: string | string[], userId: string): InMemoryAccount | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const a = accountsMap.get(idStr);
      return a && a.userId === userId ? a : null;
    },
    create(data: Omit<InMemoryAccount, "_id" | "createdAt" | "updatedAt">): InMemoryAccount {
      const id = `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const a: InMemoryAccount = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      accountsMap.set(id, a);
      return a;
    },
    update(
      id: string | string[],
      userId: string,
      payload?: InMemoryAccount["encryptedPayload"],
      accountType?: string
    ): InMemoryAccount | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const a = accountsMap.get(idStr);
      if (!a || a.userId !== userId) return null;
      if (payload) a.encryptedPayload = payload;
      if (accountType !== undefined) a.accountType = accountType;
      a.updatedAt = new Date();
      return a;
    },
    delete(id: string | string[], userId: string): boolean {
      const idStr = Array.isArray(id) ? id[0] : id;
      const a = accountsMap.get(idStr);
      if (a && a.userId === userId) {
        accountsMap.delete(idStr);
        return true;
      }
      return false;
    },
  },

  statementFiles: {
    find(userId: string, filter?: { month?: string; bank?: string }): InMemoryStatementFile[] {
      return Array.from(statementFilesMap.values())
        .filter((f) => {
          if (f.userId !== userId) return false;
          if (filter?.month && f.month !== filter.month) return false;
          if (filter?.bank && f.bank !== filter.bank) return false;
          return true;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    findById(id: string | string[], userId: string): InMemoryStatementFile | null {
      const idStr = Array.isArray(id) ? id[0] : id;
      const f = statementFilesMap.get(idStr);
      return f && f.userId === userId ? f : null;
    },
    create(data: Omit<InMemoryStatementFile, "_id" | "createdAt" | "updatedAt">): InMemoryStatementFile {
      const id = `sf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const f: InMemoryStatementFile = {
        _id: id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      statementFilesMap.set(id, f);
      return f;
    },
    delete(id: string | string[], userId: string): boolean {
      const idStr = Array.isArray(id) ? id[0] : id;
      const f = statementFilesMap.get(idStr);
      if (f && f.userId === userId) {
        statementFilesMap.delete(idStr);
        return true;
      }
      return false;
    },
  },
};
