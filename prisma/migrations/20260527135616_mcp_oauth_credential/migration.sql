-- CreateTable
CREATE TABLE "McpOAuthCredential" (
    "serverId" TEXT NOT NULL,
    "encryptedClientInfo" TEXT,
    "encryptedTokens" TEXT,
    "codeVerifier" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthCredential_pkey" PRIMARY KEY ("serverId")
);

-- AddForeignKey
ALTER TABLE "McpOAuthCredential" ADD CONSTRAINT "McpOAuthCredential_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServerConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
