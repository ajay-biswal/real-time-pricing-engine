import { prisma } from "../../config/prisma.js";

export const authRepository = {
  createMerchant(email: string, passwordHash: string) {
    return prisma.merchant.create({
      data: { email, passwordHash, role: "MERCHANT", accountStatus: "ACTIVE", kycStatus: "NOT_SUBMITTED" },
    });
  },

  findByEmail(email: string) {
    return prisma.merchant.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.merchant.findUnique({ where: { id } });
  },

  updatePasswordHash(id: string, passwordHash: string) {
    return prisma.merchant.update({ where: { id }, data: { passwordHash } });
  },
};
