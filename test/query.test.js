// The event-projections pattern's query service: the composed view it builds from three projection rows.
import { expect, test } from "vitest";
import { composed } from "../patterns/event-projections/query-service/src/index.js";

const person = { id: "person-1", name: "A", email: "a@x", hire_date: null, active: 1, last_updated: 1000 };
const employee = { id: "emp-1", title: "T", department: "D", salary: 1, active: 1, last_updated: 4000 };
const badge = { id: "badge-1", badge_number: "B1", access_level: "STANDARD", clearance: "NONE", active: 0, last_updated: 2000 };

test("one flat object from the person, employee and badge rows, in the apollo-demo's field order", () => {
  const view = composed(person, employee, badge, 5000);
  expect(view).toMatchObject({
    personId: "person-1", name: "A", personActive: true, employeeId: "emp-1", title: "T", employeeActive: true,
    badgeId: "badge-1", badgeNumber: "B1", accessLevel: "STANDARD", badgeActive: false,
  });
  expect(Object.keys(view)).toEqual(["personId", "name", "email", "hireDate", "personActive", "employeeId", "title", "department",
    "salary", "employeeActive", "badgeId", "badgeNumber", "accessLevel", "clearance", "badgeActive", "freshness"]);
});

test("missing parts are null and inactive", () => {
  expect(composed(person, null, null, 5000)).toMatchObject({
    employeeId: null, title: null, salary: null, employeeActive: false, badgeId: null, clearance: null, badgeActive: false,
  });
});

test("freshness is the age of the oldest part, formatted like the apollo-demo", () => {
  expect(composed(person, employee, null, 5000).freshness).toEqual({
    personLastUpdated: "1970-01-01T00:00:01.000Z", employeeLastUpdated: "1970-01-01T00:00:04.000Z", badgeLastUpdated: null,
    maxLagMs: 4000, dataFreshness: "4.0s", personAge: "4.0s", employeeAge: "1.0s", badgeAge: null,
  });
  expect(composed({ ...person, last_updated: 4750 }, null, null, 5000).freshness.dataFreshness).toBe("250ms");
  expect(composed({ ...person, last_updated: 0 }, null, null, 90000).freshness.dataFreshness).toBe("1.5m");
});

test("ages of hours and days read as hours and days, so a seed person is not shown in thousands of minutes", () => {
  const hour = 3600000;
  expect(composed({ ...person, last_updated: 0 }, null, null, 3 * hour).freshness.dataFreshness).toBe("3.0h");
  expect(composed({ ...person, last_updated: 0 }, null, null, 60 * hour).freshness.dataFreshness).toBe("2.5d");
});
