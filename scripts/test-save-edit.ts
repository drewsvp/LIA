import { saveStaffRequestEdits } from "../server/services/staff-request-edit";

async function main() {
  const staffUserId = "0d354bf5-75aa-49ec-8c09-27ceb123db22";
  try {
    const result = await saveStaffRequestEdits({
      kind: "item",
      requestId: "823e7bd8-caa0-490d-891e-71c1105408e5",
      staffUserId,
      fields: {
        title: "Bus Passes for Job Interviews",
        description: "Monthly transit passes so teens can reliably get to interviews and first shifts.",
        dropoffLocation: "Safe Harbor drop-in center, 5000 Rocklin Rd, Rocklin",
        peopleHelped: 10,
        deadlineType: "until_fulfilled",
        deadlineDate: null,
        contact: {
          firstName: "Grace",
          lastName: "Lin",
          email: "grace@safeharbor.example.org",
          phone: "555-0000",
        },
      },
      children: [
        {
          id: "11f6cea1-ee59-41fa-961d-9b95e714bd45",
          name: "Monthly transit pass",
          description: "A filled-in description",
          condition: "any",
          productUrl: null,
          quantityRequested: 10,
        },
      ],
    });
    console.log("SUCCESS:", JSON.stringify(result?.request?.id));
  } catch (err: unknown) {
    const e = err as Error & { code?: string; detail?: string; constraint?: string };
    console.log("ERROR:", e.name, "-", e.message);
    if (e.code) console.log("  pg code:", e.code);
    if (e.detail) console.log("  detail:", e.detail);
    if (e.constraint) console.log("  constraint:", e.constraint);
    console.log("  stack:", e.stack?.split("\n").slice(0, 10).join("\n"));
  }
  process.exit(0);
}

main();
