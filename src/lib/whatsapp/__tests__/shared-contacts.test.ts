import { describe, expect, it } from "vitest";
import { extractText } from "@/lib/whatsapp/extract-text";
import {
  formatSharedContactsText,
  getSharedContacts,
  sharedContactsFromPayload,
} from "@/lib/whatsapp/shared-contacts";

// Shape documented by the WhatsApp Cloud API for inbound `type: "contacts"`.
const metaContact = {
  name: { formatted_name: "Ana Souza", first_name: "Ana", last_name: "Souza" },
  phones: [{ phone: "+55 11 98765-4321", type: "CELL", wa_id: "5511987654321" }],
};

describe("sharedContactsFromPayload", () => {
  it("extracts name, phone and a wa.me link from a Meta contacts payload", () => {
    expect(sharedContactsFromPayload([metaContact])).toEqual([
      {
        name: "Ana Souza",
        phone: "+55 11 98765-4321",
        whatsappDigits: "5511987654321",
        whatsappUrl: "https://wa.me/5511987654321",
      },
    ]);
  });

  it("falls back to first/last name and to the phone digits when wa_id is missing", () => {
    const [c] = sharedContactsFromPayload([
      {
        name: { first_name: "Ana", last_name: "Souza" },
        phones: [{ phone: "+55 (11) 98765-4321" }],
      },
    ]);
    expect(c.name).toBe("Ana Souza");
    expect(c.whatsappUrl).toBe("https://wa.me/5511987654321");
  });

  it("keeps a local number copyable but does not guess a country code for WhatsApp", () => {
    const [c] = sharedContactsFromPayload([
      { name: { formatted_name: "Ana" }, phones: [{ phone: "(11) 98765-4321" }] },
    ]);
    expect(c.phone).toBe("(11) 98765-4321");
    expect(c.whatsappUrl).toBeNull();
  });

  it("handles contacts without phone and ignores garbage", () => {
    expect(
      sharedContactsFromPayload([{ name: { formatted_name: "Sem fone" } }, null, "x", {}]),
    ).toEqual([{ name: "Sem fone", phone: null, whatsappDigits: null, whatsappUrl: null }]);
    expect(sharedContactsFromPayload(undefined)).toEqual([]);
  });
});

describe("getSharedContacts", () => {
  it("reads contacts already persisted in source_metadata.raw (old messages)", () => {
    const contacts = getSharedContacts({
      sourceSubtype: "contacts",
      sourceMetadata: {
        wa_id: "5511900000000",
        raw: { type: "contacts", contacts: [metaContact] },
      },
    });
    expect(contacts.map((c) => c.name)).toEqual(["Ana Souza"]);
  });

  it("returns nothing for other message types", () => {
    expect(
      getSharedContacts({ sourceSubtype: "text", sourceMetadata: { raw: { type: "text" } } }),
    ).toEqual([]);
    expect(
      getSharedContacts({
        sourceSubtype: "image",
        sourceMetadata: { raw: { contacts: [metaContact] } },
      }),
    ).toEqual([]);
    expect(getSharedContacts({})).toEqual([]);
  });
});

describe("formatSharedContactsText", () => {
  it("summarises name and phone", () => {
    expect(formatSharedContactsText(sharedContactsFromPayload([metaContact]))).toBe(
      "👤 Contato: Ana Souza · +55 11 98765-4321",
    );
  });

  it("falls back to the generic label when nothing is usable", () => {
    expect(formatSharedContactsText([])).toBe("👤 Contato");
  });

  it("counts extra contacts", () => {
    const two = sharedContactsFromPayload([metaContact, metaContact]);
    expect(formatSharedContactsText(two)).toBe("👤 Contato: Ana Souza · +55 11 98765-4321 (+1)");
  });
});

describe("extractText for contacts", () => {
  it("persists name and phone in messages.text", () => {
    expect(
      extractText({
        id: "wamid.1",
        from: "5511900000000",
        type: "contacts",
        contacts: [metaContact],
      }),
    ).toBe("👤 Contato: Ana Souza · +55 11 98765-4321");
  });
});
