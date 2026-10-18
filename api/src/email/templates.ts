import type { SubmissionChange, RsvpRecord } from "../rsvp/model"
import { toWhatsAppNumber } from "../rsvp/phone"
import { escapeHtml, stripLineBreaks } from "./escape"
import {
  BODY_FONT,
  bodyRow,
  buttonsRow,
  displayRow,
  envelopeLayout,
  monogramRow,
  pillRow,
} from "./layout"

export type RenderedEmail = { subject: string; html: string; text: string }

type Totals = { accepted: number; guests: number; declined: number }

const GUEST_SUBJECT_ACCEPTS = "Your RSVP is in — see you on 12 December"
const GUEST_SUBJECT_DECLINES = "We'll miss you — Chris & Miriam"

const guestCount = (count: number): string =>
  `${count} guest${count === 1 ? "" : "s"}`

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ""
}

function answerLabel(attendance: string, partySize: number): string {
  return attendance === "accepts"
    ? `Joyfully accepts, party of ${partySize}`
    : "Regretfully declines"
}

function scheduleRows(): string {
  const time = (clock: string, caption: string): string =>
    `<td width="50%" align="center" valign="top" style="padding:0 6px;font-family:Didot,'Bodoni 72','Bodoni MT',Georgia,serif;">
<div style="color:#f0ce83;font-size:22px;">${clock}</div>
<div style="padding-top:6px;color:#c5a77d;font-size:11px;letter-spacing:1px;line-height:1.6;">${caption}</div>
</td>`
  const swatch = (colour: string, title: string): string =>
    `<td height="26" style="background:${colour};" title="${title}"></td>`

  return [
    displayRow("SATURDAY", {
      color: "#d9a84c",
      size: 13,
      spacing: 5,
      top: 34,
    }),
    displayRow(
      '12<span style="color:#d9a84c;">·</span>12<span style="color:#d9a84c;">·</span>26',
      { color: "#f5e9d6", size: 52, top: 6 }
    ),
    displayRow("SHERATON HOTEL&nbsp;·&nbsp;MAKURDI", {
      color: "#d9a84c",
      size: 12,
      spacing: 2,
      top: 12,
    }),
    `<tr><td style="padding:26px 22px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
${time("7:00 AM", "WHITE WEDDING<br>CEREMONY")}
${time("2:00 PM", "TRADITIONAL WEDDING<br>RECEPTION")}
</tr>
</table>
</td></tr>`,
    displayRow("COLOURS OF THE DAY", {
      color: "#d9a84c",
      size: 12,
      spacing: 3,
      top: 30,
    }),
    `<tr><td align="center" style="padding:10px 22px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #8f6a2e;">
<tr>
${swatch("#c79a45", "Gold")}
${swatch("#7a1420", "Burgundy")}
${swatch("#5a3420", "Coffee brown")}
${swatch("#4f5a32", "Army green")}
${swatch("#2b2b2d", "Charcoal ash")}
</tr>
</table>
</td></tr>`,
    bodyRow("Gold, burgundy, coffee brown, army green and charcoal ash", {
      color: "#c5a77d",
      size: 12,
      top: 8,
    }),
    displayRow("YOUR PRESENCE IS OUR GREATEST GIFT", {
      color: "#d9a84c",
      size: 12,
      spacing: 3,
      top: 30,
    }),
  ].join("\n")
}

export function renderGuestEmail(
  record: RsvpRecord,
  siteUrl: string
): RenderedEmail {
  const accepts = record.attendance === "accepts"
  const firstName = firstNameOf(record.name)
  const safeFirst = escapeHtml(firstName)
  const label = answerLabel(record.attendance, record.partySize)
  const intro = accepts
    ? "Your reply has reached us, and we can't wait to celebrate with you."
    : "We're sorry you can't make it, and we'll miss you. Thank you for letting us know."
  const safeSite = escapeHtml(siteUrl)

  const rows = [
    monogramRow(34, 18),
    displayRow(`Thank you, ${safeFirst}`, {
      color: "#f5e9d6",
      size: 30,
      top: 26,
    }),
    bodyRow(intro, { color: "#e3cfb0", size: 16, top: 12 }),
    pillRow(label),
    accepts ? scheduleRows() : "",
    bodyRow(
      `Reply to this email to reach Chris and Miriam.<br>Need to change your answer? <a href="${safeSite}/" style="color:#f0ce83;">Open the invitation</a> and send your RSVP again with the same email.`,
      { color: "#a98d69", size: 13, top: 26, bottom: 34 }
    ),
  ].join("\n")

  const text = accepts
    ? [
        `Thank you, ${firstName}`,
        "",
        intro,
        label,
        "",
        "Saturday, 12 December 2026",
        "Sheraton Hotel, Makurdi",
        "7:00 AM  White wedding ceremony",
        "2:00 PM  Traditional wedding reception",
        "Colours of the day: gold, burgundy, coffee brown, army green and charcoal ash",
        "",
        "Your presence is our greatest gift.",
        "",
        "Reply to this email to reach Chris and Miriam.",
        `Need to change your answer? Open ${siteUrl}/ and send your RSVP again with the same email.`,
      ].join("\n")
    : [
        `Thank you, ${firstName}`,
        "",
        intro,
        label,
        "",
        "Reply to this email to reach Chris and Miriam.",
        `Need to change your answer? Open ${siteUrl}/ and send your RSVP again with the same email.`,
      ].join("\n")

  return {
    subject: accepts ? GUEST_SUBJECT_ACCEPTS : GUEST_SUBJECT_DECLINES,
    html: envelopeLayout(rows),
    text,
  }
}

function previousAnswer(record: RsvpRecord): string {
  if (record.previousAttendance === "accepts") {
    return `party of ${record.previousPartySize}`
  }
  return "declining"
}

function coupleSubject(record: RsvpRecord, change: SubmissionChange): string {
  const name = stripLineBreaks(record.name)
  const accepts = record.attendance === "accepts"
  if (change === "new") {
    return accepts
      ? `${name} joyfully accepts (party of ${record.partySize})`
      : `${name} regretfully declines`
  }
  if (change === "unchanged") return `${name} updated their RSVP`
  const was = previousAnswer(record)
  return accepts
    ? `${name} changed their RSVP: now joyfully accepts (party of ${record.partySize}, was ${was})`
    : `${name} changed their RSVP: now regretfully declines (was ${was})`
}

function detailRow(label: string, value: string, last: boolean): string {
  const border = `border-top:1px solid #5e2a1c;${last ? "border-bottom:1px solid #5e2a1c;" : ""}`
  return `<tr><td valign="top" style="padding:10px 0;${border}color:#c5a77d;width:92px;">${label}</td><td style="padding:10px 0;${border}color:#f5e9d6;">${value}</td></tr>`
}

export function renderCoupleEmail(args: {
  record: RsvpRecord
  change: SubmissionChange
  totals?: Totals
  siteUrl: string
}): RenderedEmail {
  const { record, change, totals, siteUrl } = args
  const accepts = record.attendance === "accepts"
  const firstName = firstNameOf(record.name)
  const label = answerLabel(record.attendance, record.partySize)
  const adminUrl = `${siteUrl}/admin/`
  const whatsApp = toWhatsAppNumber(record.phone)
  const telPhone = record.phone.replace(/\s+/g, "")
  const previous =
    change === "changed" ? `Previously: ${previousAnswer(record)}` : null

  const safeEmail = escapeHtml(record.email)
  const link = (href: string, text: string): string =>
    `<a href="${href}" style="color:#f0ce83;">${text}</a>`
  const messageRow =
    record.message === ""
      ? []
      : [
          [
            "Message",
            `<span style="font-style:italic;">“${escapeHtml(record.message)}”</span>`,
          ],
        ]
  const detailCells = [
    ["Email", link(`mailto:${safeEmail}`, safeEmail)],
    ["Phone", link(`tel:${escapeHtml(telPhone)}`, escapeHtml(record.phone))],
    ...messageRow,
  ]
  const details = detailCells.map(([label, value], index) =>
    detailRow(label, value, index === detailCells.length - 1)
  )

  const seeAll = {
    label: "See all RSVPs",
    href: escapeHtml(adminUrl),
    primary: whatsApp === null,
  }
  const buttons =
    whatsApp === null
      ? [seeAll]
      : [
          {
            label: `WhatsApp ${escapeHtml(firstName)}`,
            href: `https://wa.me/${whatsApp}`,
            primary: true,
          },
          seeAll,
        ]

  const rows = [
    monogramRow(30, 16),
    displayRow(
      `${escapeHtml(record.name)} ${accepts ? "is coming" : "can't make it"}`,
      { color: "#f5e9d6", size: 27, top: 20 }
    ),
    bodyRow(label, { color: "#e3cfb0", size: 15, top: 8 }),
    previous === null
      ? ""
      : bodyRow(previous, { color: "#c5a77d", size: 13, top: 4 }),
    `<tr><td style="padding:26px 22px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${BODY_FONT};font-size:15px;line-height:1.5;">
${details.join("\n")}
</table>
</td></tr>`,
    totals === undefined
      ? ""
      : bodyRow(
          `So far: <span style="color:#f0ce83;">${totals.accepted} accepted</span> bringing <span style="color:#f0ce83;">${guestCount(totals.guests)}</span>, and ${totals.declined} declined.`,
          { color: "#e3cfb0", size: 15, top: 26 }
        ),
    buttonsRow(buttons),
  ].join("\n")

  const text = [
    `${record.name} ${accepts ? "is coming" : "can't make it"}`,
    label,
    ...(previous === null ? [] : [previous]),
    "",
    `Email: ${record.email}`,
    `Phone: ${record.phone}`,
    ...(record.message === "" ? [] : [`Message: ${record.message}`]),
    "",
    ...(totals === undefined
      ? []
      : [
          `So far: ${totals.accepted} accepted bringing ${guestCount(totals.guests)}, and ${totals.declined} declined.`,
          "",
        ]),
    ...(whatsApp === null ? [] : [`WhatsApp: https://wa.me/${whatsApp}`]),
    `See all RSVPs: ${adminUrl}`,
  ].join("\n")

  return {
    subject: coupleSubject(record, change),
    html: envelopeLayout(rows),
    text,
  }
}
