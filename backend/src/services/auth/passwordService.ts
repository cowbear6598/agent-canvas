import { canvasStore } from "../canvasStore.js";
import { configStore, type WorkspacePasswordState } from "../configStore.js";
import { err, ok, type Result } from "../../types/result.js";
import type { Canvas } from "../../types/canvas.js";

const MAX_PASSWORD_LENGTH = 256;

export type PasswordUpdateAction =
  | {
      action: "set";
      newPassword: string;
    }
  | {
      action: "change";
      currentPassword: string;
      newPassword: string;
    }
  | {
      action: "remove";
      currentPassword: string;
    };

export interface CanvasPasswordUpdateResult {
  canvas: Canvas;
  passwordVersion: number;
}

function normalizePassword(value: string): string {
  return value.trim();
}

class PasswordService {
  private validateNewPassword(password: string): Result<string> {
    const normalized = normalizePassword(password);
    if (!normalized) {
      return err("Password cannot be empty");
    }

    if (normalized.length > MAX_PASSWORD_LENGTH) {
      return err("Password is too long");
    }

    return ok(normalized);
  }

  private async hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, {
      algorithm: "argon2id",
    });
  }

  private async verifyHash(
    plainTextPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return Bun.password.verify(plainTextPassword, passwordHash);
  }

  async verifyWorkspaceUnlock(
    password: string,
  ): Promise<Result<WorkspacePasswordState>> {
    const workspacePassword = configStore.getWorkspacePasswordState();
    if (!workspacePassword.passwordHash) {
      return ok(workspacePassword);
    }

    const verified = await this.verifyHash(
      normalizePassword(password),
      workspacePassword.passwordHash,
    );

    if (!verified) {
      return err("Wrong workspace password");
    }

    return ok(workspacePassword);
  }

  async updateWorkspacePassword(
    action: PasswordUpdateAction,
  ): Promise<Result<WorkspacePasswordState>> {
    const currentState = configStore.getWorkspacePasswordState();

    if (action.action === "set") {
      if (currentState.passwordHash !== null) {
        return err("Workspace password already exists");
      }

      const validated = this.validateNewPassword(action.newPassword);
      if (!validated.success) {
        return validated;
      }

      const passwordHash = await this.hashPassword(validated.data);
      return ok(configStore.setWorkspacePasswordHash(passwordHash));
    }

    if (!currentState.passwordHash) {
      return err("Workspace password is not set");
    }

    const currentVerified = await this.verifyHash(
      normalizePassword(action.currentPassword),
      currentState.passwordHash,
    );
    if (!currentVerified) {
      return err("Wrong workspace password");
    }

    if (action.action === "remove") {
      return ok(configStore.clearWorkspacePassword());
    }

    const validated = this.validateNewPassword(action.newPassword);
    if (!validated.success) {
      return validated;
    }

    const passwordHash = await this.hashPassword(validated.data);
    return ok(configStore.setWorkspacePasswordHash(passwordHash));
  }

  async verifyCanvasUnlock(
    canvasId: string,
    password: string,
  ): Promise<Result<{ canvas: Canvas; passwordVersion: number }>> {
    const canvas = canvasStore.getById(canvasId);
    if (!canvas) {
      return err("Canvas not found");
    }

    const passwordInfo = canvasStore.getPasswordInfo(canvasId);
    if (!passwordInfo?.passwordHash) {
      return ok({ canvas, passwordVersion: canvas.passwordVersion });
    }

    const verified = await this.verifyHash(
      normalizePassword(password),
      passwordInfo.passwordHash,
    );
    if (!verified) {
      return err("Wrong canvas password");
    }

    return ok({
      canvas,
      passwordVersion: passwordInfo.passwordVersion,
    });
  }

  async updateCanvasPassword(
    canvasId: string,
    action: PasswordUpdateAction,
  ): Promise<Result<CanvasPasswordUpdateResult>> {
    const canvas = canvasStore.getById(canvasId);
    if (!canvas) {
      return err("Canvas not found");
    }

    const passwordInfo = canvasStore.getPasswordInfo(canvasId);
    const currentHash = passwordInfo?.passwordHash ?? null;
    const nextVersion = (passwordInfo?.passwordVersion ?? 0) + 1;

    if (action.action === "set") {
      if (currentHash !== null) {
        return err("Canvas password already exists");
      }

      const validated = this.validateNewPassword(action.newPassword);
      if (!validated.success) {
        return validated;
      }

      const passwordHash = await this.hashPassword(validated.data);
      const updatedCanvas = canvasStore.setPasswordHash(
        canvasId,
        passwordHash,
        nextVersion,
      );
      if (!updatedCanvas) {
        return err("Canvas not found");
      }

      return ok({ canvas: updatedCanvas, passwordVersion: nextVersion });
    }

    if (!currentHash) {
      return err("Canvas password is not set");
    }

    const currentVerified = await this.verifyHash(
      normalizePassword(action.currentPassword),
      currentHash,
    );
    if (!currentVerified) {
      return err("Wrong canvas password");
    }

    if (action.action === "remove") {
      const updatedCanvas = canvasStore.clearPasswordHash(canvasId, nextVersion);
      if (!updatedCanvas) {
        return err("Canvas not found");
      }

      return ok({ canvas: updatedCanvas, passwordVersion: nextVersion });
    }

    const validated = this.validateNewPassword(action.newPassword);
    if (!validated.success) {
      return validated;
    }

    const passwordHash = await this.hashPassword(validated.data);
    const updatedCanvas = canvasStore.setPasswordHash(
      canvasId,
      passwordHash,
      nextVersion,
    );
    if (!updatedCanvas) {
      return err("Canvas not found");
    }

    return ok({ canvas: updatedCanvas, passwordVersion: nextVersion });
  }
}

export const passwordService = new PasswordService();
