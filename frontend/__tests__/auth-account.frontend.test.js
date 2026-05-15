import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  __setMockUser,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

async function freshAuth() {
  return import("../js/auth.js");
}

describe("AUTH / ACCOUNT frontend helpers", () => {
  beforeEach(() => {
    __setMockUser(null);
  });

  it("rejects weak passwords with specific requirements", async () => {
    const { validatePassword, getPasswordStrength } = await freshAuth();
    const result = validatePassword("weak");
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "At least 8 characters",
      "At least one uppercase letter",
      "At least one number",
    ]));
    expect(getPasswordStrength("Strong1!").label).toBe("Strong");
  });

  it("valid sign up calls Firebase and sends verification by default", async () => {
    const { register } = await freshAuth();
    const user = await register("new@bloom.test", "Strong1!");

    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(
      expect.anything(),
      "new@bloom.test",
      "Strong1!"
    );
    expect(sendEmailVerification).toHaveBeenCalledWith(user);
    expect(localStorage.getItem("bloom_mode")).toBe("account");
  });

  it("underage sign up path can skip verification email before guardian consent", async () => {
    const { register } = await freshAuth();
    await register("minor@bloom.test", "Strong1!", { skipVerificationEmail: true });
    expect(createUserWithEmailAndPassword).toHaveBeenCalled();
    expect(sendEmailVerification).not.toHaveBeenCalled();
  });

  it("duplicate email error is surfaced from Firebase for page UI handling", async () => {
    createUserWithEmailAndPassword.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), { code: "auth/email-already-in-use" })
    );
    const { register } = await freshAuth();
    await expect(register("taken@bloom.test", "Strong1!")).rejects.toMatchObject({
      code: "auth/email-already-in-use",
    });
  });

  it("valid login returns verified user and stores account mode", async () => {
    const { login } = await freshAuth();
    const user = await login("rose@bloom.test", "Strong1!");
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), "rose@bloom.test", "Strong1!");
    expect(user.email).toBe("rose@bloom.test");
    expect(localStorage.getItem("bloom_mode")).toBe("account");
  });

  it("invalid login shows a Firebase error code for UI display", async () => {
    signInWithEmailAndPassword.mockRejectedValueOnce(
      Object.assign(new Error("bad credentials"), { code: "auth/invalid-credential" })
    );
    const { login } = await freshAuth();
    await expect(login("bad@bloom.test", "Wrong1!")).rejects.toMatchObject({
      code: "auth/invalid-credential",
    });
  });

  it("unverified login signs back out and throws email-not-verified", async () => {
    signInWithEmailAndPassword.mockResolvedValueOnce({
      user: {
        uid: "u1",
        email: "pending@bloom.test",
        emailVerified: false,
        getIdToken: vi.fn(async () => "token"),
      },
    });
    const { login } = await freshAuth();
    await expect(login("pending@bloom.test", "Strong1!")).rejects.toMatchObject({
      code: "auth/email-not-verified",
      unverifiedEmail: "pending@bloom.test",
    });
    expect(sendEmailVerification).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it("logout clears local session data and signs out", async () => {
    localStorage.setItem("bloom_daily_logs", "{}");
    localStorage.setItem("bloom_profile", JSON.stringify({ nickname: "Rose" }));
    localStorage.setItem("bloom_is_admin", "1");
    sessionStorage.setItem("temp", "1");
    const { logout } = await freshAuth();

    await logout();

    expect(localStorage.getItem("bloom_daily_logs")).toBeNull();
    expect(localStorage.getItem("bloom_profile")).toBeNull();
    expect(localStorage.getItem("bloom_is_admin")).toBeNull();
    expect(sessionStorage.getItem("temp")).toBeNull();
    expect(signOut).toHaveBeenCalled();
  });
});
