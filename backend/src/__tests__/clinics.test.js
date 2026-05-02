import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.hoisted(() => vi.fn());
const mockCollection = vi.hoisted(() => vi.fn());

vi.mock("../firebaseAdmin.js", () => ({
  db: {
    collection: mockCollection,
  },
}));

import { listClinics } from "../routes/clinics.js";

const TEST_CLINICS = [
  {
    id: "may-pen-health-centre",
    name: "May Pen Health Centre",
    parish: "Clarendon",
    type: "health_center",
    address: "Denbigh, May Pen, Clarendon",
    services: ["FamilyPlanning", "Maternity"],
    phones: [],
    status: "active",
  },
  {
    id: "victoria-jubilee",
    name: "Victoria Jubilee Hospital",
    parish: "Kingston",
    type: "hospital",
    address: "North Street, Kingston",
    services: ["Maternity", "OBGYN"],
    phones: ["876-922-0210"],
    status: "active",
  },
  {
    id: "draft-clinic",
    name: "Draft Clinic",
    parish: "Kingston",
    type: "private",
    address: "Hidden",
    services: ["OBGYN"],
    status: "draft",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockCollection.mockReturnValue({ get: mockGet });
  mockGet.mockResolvedValue({
    docs: TEST_CLINICS.map(({ id, ...data }) => ({
      id,
      data: () => data,
    })),
  });
});

describe("listClinics", () => {
  it("reads from the clinicDirectory collection and returns active clinics", async () => {
    const clinics = await listClinics();

    expect(mockCollection).toHaveBeenCalledWith("clinicDirectory");
    expect(clinics).toHaveLength(2);
    expect(clinics.map((clinic) => clinic.id)).not.toContain("draft-clinic");
  });

  it("filters by parish and search query", async () => {
    const clinics = await listClinics({ parish: "Kingston", q: "jubilee" });

    expect(clinics).toHaveLength(1);
    expect(clinics[0].id).toBe("victoria-jubilee");
  });

  it("filters by service", async () => {
    const clinics = await listClinics({ service: "FamilyPlanning" });

    expect(clinics).toHaveLength(1);
    expect(clinics[0].id).toBe("may-pen-health-centre");
  });
});
