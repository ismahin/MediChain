import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("public system configuration", () => {
  it("serves runtime policy without exposing blockchain secrets", async () => {
    const response = await request(app).get("/api/config").expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.appName).toBeTruthy();
    expect(response.body.data.access.maxDurationHours).toBeGreaterThan(0);
    expect(response.body.data.access.roleCategories.DOCTOR.length).toBeGreaterThan(0);
    expect(response.body.data.access.roleCategories.LABORATORY).toEqual(["Diagnostic reports only"]);
    expect(response.body.data.blockchain).not.toHaveProperty("privateKey");
    expect(JSON.stringify(response.body.data)).not.toContain(process.env.BLOCKCHAIN_PRIVATE_KEY ?? "__no_private_key__");
  });
});
