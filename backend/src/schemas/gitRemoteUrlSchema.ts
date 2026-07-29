import { z } from "zod";

function hasNoEmbeddedCredentials(value: string): boolean {
  if (value.startsWith("git@")) return true;
  try {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export const gitRemoteUrlSchema = z
  .string()
  .regex(/^(git@|https:\/\/)/, "URL 必須以 git@ 或 https:// 開頭")
  .refine(hasNoEmbeddedCredentials, "Remote URL 不可包含帳號、密碼或 Token");
