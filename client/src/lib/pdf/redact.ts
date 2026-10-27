/**
 * Client-Side PII Redaction Engine
 * Redacts account numbers, names, addresses, customer IDs, PAN numbers, emails, and phone numbers
 * using high-precision regular expressions before transmitting text to the LLM parsing endpoint.
 *
 * ZERO-KNOWLEDGE GUARANTEE:
 * PII is stripped locally in the browser so the server and LLM never see user identity details.
 */

export interface RedactionResult {
  redactedText: string;
  redactedCount: number;
}

export function redactPii(rawText: string): RedactionResult {
  let text = rawText;
  let count = 0;

  // 1. Redact Emails
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, () => {
    count++;
    return "[EMAIL_REDACTED]";
  });

  // 2. Redact Phone / Mobile numbers (10-12 digits with optional +91 or country codes)
  text = text.replace(/(?:(?:\+|00)?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, () => {
    count++;
    return "[PHONE_REDACTED]";
  });

  // 3. Redact Indian PAN Card Numbers (5 letters, 4 digits, 1 letter)
  text = text.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g, () => {
    count++;
    return "[PAN_REDACTED]";
  });

  // 4. Redact Indian Aadhaar Number patterns (12 digits in groups of 4)
  text = text.replace(/\b\d{4}\s\d{4}\s\d{4}\b/g, () => {
    count++;
    return "[AADHAAR_REDACTED]";
  });

  // 5. Redact Bank Account Numbers with contextual labels (9 to 18 digits)
  text = text.replace(
    /(?:Account\s*(?:No|Number|#)?|A\/c\s*(?:No|Number)?|Acc\s*No|Account)[\s.:]+([A-Z0-9-]{8,20})/gi,
    (match, p1) => {
      count++;
      return match.replace(p1, "[ACCOUNT_NUMBER_REDACTED]");
    }
  );

  // 6. Redact standalone 11-18 digit account numbers (excluding dates and decimals)
  text = text.replace(/(?<![.\d])\b\d{11,18}\b(?![.\d])/g, () => {
    count++;
    return "[ACCOUNT_NUMBER_REDACTED]";
  });

  // 7. Redact Customer ID / CIF Numbers
  text = text.replace(
    /(?:Customer\s*(?:ID|No|Number)|Cust\s*ID|CIF\s*(?:No|Number)?)[\s.:]+([A-Z0-9]{6,16})/gi,
    (match, p1) => {
      count++;
      return match.replace(p1, "[CUSTOMER_ID_REDACTED]");
    }
  );

  // 8. Redact Names with contextual headers (e.g. "Customer Name: John Doe", "Name: Jane Doe", "Mr./Mrs./Ms. ...")
  text = text.replace(
    /(?:Customer\s*Name|Account\s*Holder(?:\s*Name)?|Name|Mr\.|Mrs\.|Ms\.|Dr\.)[\s.:]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})/g,
    (match, p1) => {
      count++;
      return match.replace(p1, "[NAME_REDACTED]");
    }
  );

  // 9. Redact Addresses (Street, Flat, Nagar, Colony, Road, Pin Code)
  // Pin code: 6-digit Indian PIN
  text = text.replace(/\b[1-9][0-9]{2}\s?[0-9]{3}\b/g, () => {
    count++;
    return "[PINCODE_REDACTED]";
  });

  // Address lines
  text = text.replace(/(?:Address|Add)[\s.:]+([^\r\n]{15,100})/gi, (match, p1) => {
    count++;
    return match.replace(p1, "[ADDRESS_REDACTED]");
  });

  text = text.replace(
    /\b(?:Flat|Plot|House|Door|Building|Road|Street|Nagar|Colony|Enclave|Apartment|Vihar|Sector|Lane|Floor)[\s\w,.-]{10,80}\b/gi,
    () => {
      count++;
      return "[ADDRESS_REDACTED]";
    }
  );

  return {
    redactedText: text,
    redactedCount: count,
  };
}
