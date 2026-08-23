/** staff_invited — new staff member invited at ADMIN-09. */
import {
  shell,
  button,
  textKv,
  textBody,
  fillText,
  copyPara,
  copyText,
  renderBodyBlocksHtml,
  renderBodyBlocksToTextBlocks,
  type TemplateCopy,
  type TemplateSectionDef,
} from "../render";
import type { ProductTemplate } from "./types";

export type StaffInvitedVars = {
  inviteeName: string;
  inviteeRole: string;
  loginUrl: string;
};

const DEFAULT_COPY: TemplateCopy = {
  subject: "You've been added to the Alliance staff portal",
  heading: "Welcome to the Alliance Staff Portal",
  paragraphs: [
    "Hi {inviteeName}, you have been added to the Alliance staff portal as {inviteeRole}. Use the button below to sign in — enter your email address and you will receive a magic-link login email.",
  ],
};

const SECTIONS: TemplateSectionDef<StaffInvitedVars>[] = [
  {
    name: "login_button",
    label: "Sign in button",
    renderHtml: (vars) => button("Sign in to the staff portal", vars.loginUrl),
    renderText: (vars) => [textKv("Sign in to the staff portal", vars.loginUrl)],
  },
];

const DEFAULT_BLOCKS: import("../render").BodyBlock[] = [
  { kind: "paragraph", html: DEFAULT_COPY.paragraphs[0]! },
  { kind: "section", name: "login_button" },
];

export const staffInvited: ProductTemplate<StaffInvitedVars> = {
  key: "staff_invited",
  entityType: "org_membership",
  required: ["inviteeName", "inviteeRole", "loginUrl"],
  trigger: "A staff admin invites a new staff member",
  recipients: "The invited person",
  recipientsConfigurable: false,
  defaultCopy: DEFAULT_COPY,
  sections: SECTIONS,
  defaultBlocks: DEFAULT_BLOCKS,
  sample: {
    inviteeName: "Jordan Lee",
    inviteeRole: "Staff Approver",
    loginUrl: "https://example.org/login",
  },
  render(vars, copy = DEFAULT_COPY) {
    const subject = fillText(copy.subject, vars);
    const bodyHtml = copy.bodyBlocks?.length
      ? renderBodyBlocksHtml(copy.bodyBlocks, vars, SECTIONS)
      : [
          copyPara(copy.paragraphs[0] ?? "", vars),
          button("Sign in to the staff portal", vars.loginUrl),
        ]
          .filter(Boolean)
          .join("\n");
    const html = shell(fillText(copy.heading, vars), bodyHtml);
    const text = copy.bodyBlocks?.length
      ? textBody(copyText(copy.heading, vars), ...renderBodyBlocksToTextBlocks(copy.bodyBlocks, vars, SECTIONS))
      : textBody(
          copyText(copy.heading, vars),
          copyText(copy.paragraphs[0] ?? "", vars),
          textKv("Sign in to the staff portal", vars.loginUrl),
        );
    return { subject, html, text };
  },
};
