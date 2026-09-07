# MedFlow — User Manual

A simple, step-by-step guide for everyday users.  
No technical setup is required — you only need a web browser.

**Live app:** [https://medflow-13-50-17-61.sslip.io](https://medflow-13-50-17-61.sslip.io)

---

## Table of contents

1. [What MedFlow is](#1-what-medflow-is)
2. [How to open and sign in](#2-how-to-open-and-sign-in)
3. [Create an account](#3-create-an-account)
4. [Forgot password](#4-forgot-password)
5. [Tour of the screen](#5-tour-of-the-screen)
6. [Who does what (roles)](#6-who-does-what-roles)
7. [The full purchase journey (big picture)](#7-the-full-purchase-journey-big-picture)
8. [Requester guide](#8-requester-guide)
9. [Team Leader guide](#9-team-leader-guide)
10. [Procurement guide](#10-procurement-guide)
11. [Director guide](#11-director-guide)
12. [Managing Director (MD) guide](#12-managing-director-md-guide)
13. [Finance guide](#13-finance-guide)
14. [Admin guide](#14-admin-guide)
15. [Using Copilot (AI assistant)](#15-using-copilot-ai-assistant)
16. [Notifications](#16-notifications)
17. [Settings & sign out](#17-settings--sign-out)
18. [Reading status badges](#18-reading-status-badges)
19. [Tips & common problems](#19-tips--common-problems)

---

## 1. What MedFlow is

MedFlow is a **pharmaceutical procurement** workspace. It tracks a purchase request (called an **indent**) from the moment someone asks for an item until payment is finished.

Think of an indent as a digital file that moves from person to person:

**You raise it → Team Lead reviews → Procurement finds vendors → Approvals → Purchase Order → Finance → Closed**

Everyone sees the same case page. What you can click depends on your **role**.

---

## 2. How to open and sign in

### Step 1 — Open the app

1. Open Chrome, Safari, Edge, or Firefox.
2. Go to: **https://medflow-13-50-17-61.sslip.io**
3. You should land on the **Sign in** page (or be sent there automatically).

### Step 2 — Sign in

On the white **Sign in** card:

1. In **Email or username**, type your email **or** username (either works).
2. In **Password**, type your password.
3. Optional: click the **eye** icon on the right to show/hide the password.
4. Click the blue **Sign in** button.

You will be taken to **Overview** (the dashboard).

> If login fails, double-check spelling and caps lock. Ask your admin for the correct password — do not share passwords in screenshots or chat.

---

## 3. Create an account

Only do this if your organization allows self-registration.

1. On the Sign in page, click **Create Account** at the bottom.
2. Fill in:
   - **Name**
   - **Email**
   - **Username**
   - **Role** (Requester, Team Leader, Procurement, Finance, Director, or Managing Director)
   - **Password** and **Confirm password**
3. Click **Create Account**.
4. You return to Sign in with a short “Account created” message.
5. Sign in with the email/username and password you just set.

> **Note:** You cannot create an **Admin** account from this page. Admin accounts are created by an existing Admin only.

---

## 4. Forgot password

1. On Sign in, click **Forgot password?**
2. Enter your email and follow the on-screen instructions.
3. When you receive a reset link (if email is configured for your environment), open it and set a new password.
4. Sign in again with the new password.

If reset email is not available in your environment, ask your Admin to set a new password for you under **User management**.

---

## 5. Tour of the screen

After you sign in, the workspace looks like this:

### Left side — main menu (desktop)

A vertical sidebar with MedFlow at the top. Menu items change by role. Examples:

| Menu label | What it is |
|------------|------------|
| **Overview** | Home dashboard with counts and shortcuts |
| **Indents** | List of purchase cases |
| **Copilot** | AI chat assistant |
| **Notifications** | Alerts about your cases |
| **Team Lead queue** / **Director approvals** / **MD approvals** | Work waiting for your decision |
| **Queue** | Procurement’s active cases |
| **Vendors** / **Items** | Master lists (Procurement / Admin) |
| **Documents** | Document center |
| **Payments** | Finance workspace |
| **User management** | Admin only |

Click any menu item once to open that page. The active page is highlighted.

### Top right — your profile

Click your **name / initials** to open a small menu:

- **Settings** — view profile and change password  
- **Sign out** — leave the app safely  

### Phone / small screen

Instead of the left sidebar, you get a **horizontal menu** under the header. Swipe sideways if needed. Extra links are under **More**.

### Inside a case (indent page)

When you open one indent, you see:

1. A **workflow tracker** bar at the top (Requester → Team Lead → Procurement → …).
2. Collapsible **sections** (like folders), for example:
   - Indent Request Form  
   - Team Lead Section 1  
   - Procurement Section 1  
   - Team Lead Section 2  
   - Director / MD sections  
   - Procurement Section 2 — PO & Proforma  
   - Finance sections  
3. Each section header shows:
   - **Active** (you can work here now), or  
   - **Read only** (you can look, but not edit)
4. Click the section title (or the chevron) to expand / collapse it.

---

## 6. Who does what (roles)

| Role | Everyday job in MedFlow |
|------|-------------------------|
| **Requester** | Creates and submits purchase indents; tracks status; uploads supporting PDFs |
| **Team Leader** | Approves/rejects the indent first; later reviews the vendor choice |
| **Procurement** | Sends enquiries, collects quotes, runs AI match, nominates vendor, uploads PO / proforma |
| **Director** | Approves higher-value vendor selections (above ₹50,000) |
| **MD** | Approves very high-value cases (above ₹5,00,000) |
| **Finance** | Completes accounts / payment steps |
| **Admin** | Manages users; can view many screens; does **not** replace TL/Director/MD approvals |

---

## 7. The full purchase journey (big picture)

```
Requester creates indent (Draft)
        ↓  clicks Send
Team Lead Section 1 (approve / reject)
        ↓  if approved
Procurement: vendors → enquiry → quotes → AI match → pick vendor
        ↓  Send
Team Lead Section 2 (vendor approve / reject)
        ↓
Director (if budget > ₹50,000)
        ↓
MD (if budget > ₹5,00,000)
        ↓
Procurement: upload PO → proforma → Send to finance
        ↓
Finance: accounts → payment steps → case Closed
```

**Budget routing (set by Procurement when nominating a vendor):**

| Approval value | Who must approve after Team Lead |
|----------------|----------------------------------|
| Up to ₹50,000 | Team Lead only (Director/MD not required) |
| Above ₹50,000 up to ₹5,00,000 | Director |
| Above ₹5,00,000 | Director, then MD |

---

## 8. Requester guide

### 8.1 Open your home view

1. Sign in as Requester.
2. Click **Overview** in the left menu.
3. You will see tiles such as **Drafts**, **In flight**, and **Rejected**.
4. Click a tile to jump to the matching indent list.

### 8.2 See all your indents

1. Click **Indents**.
2. Use the search box (**Search reference, item, requester…**) and click **Search** if needed.
3. Click a **reference** (for example `IND-2026-0001`) to open the case.

### 8.3 Raise a new indent

1. On **Indents**, click the blue **Raise indent** button (top right).  
   Or go to **Overview** and use the raise shortcut if shown.
2. You see the **Indent Request Form**.
3. Fill in:
   - **Name of item** — choose from the dropdown catalog  
   - **Quantity** — must be greater than zero  
   - **Priority** — click **High**, **Medium**, or **Low**  
   - **Specifications** — filled automatically from the catalog (read-only)  
   - **Reason for acquiring product** — type why you need it  
4. Choose one action:
   - **Save draft** — saves without sending; you can finish later  
   - **Send** — saves and immediately sends to Team Lead for review  
5. You are taken to the indent detail page.

### 8.4 Send a draft later

1. Open **Indents** → open your draft case.
2. In **Indent Request Form**, click **Send**.
3. Status moves to waiting for Team Lead.

### 8.5 Download the indent PDF

1. Open the indent.
2. Near the top actions, click **Download indent PDF**.
3. The PDF downloads in your browser.

### 8.6 Attach a supporting PDF (when allowed)

On a draft (or when the documents section allows upload):

1. Open the indent.
2. Find the **Documents** area on the case.
3. Upload a real **PDF** file only (other file types are rejected).
4. Use **Download** next to a file name to open it later.

### 8.7 What Requesters should not try to do

You will not see (or cannot use) Procurement RFQ tools, vendor master edits, finance bank fields, or approval **Approve/Reject** controls. That is intentional.

---

## 9. Team Leader guide

You decide at **two** possible moments:

1. **Team Lead Section 1** — Is this indent request valid?  
2. **Team Lead Section 2** — Is Procurement’s chosen vendor acceptable?

### 9.1 Find work waiting for you

**Option A — Queue**

1. Click **Team Lead queue** in the left menu.
2. You see a list of pending cases.
3. Click a case to open it.

**Option B — Overview**

1. Click **Overview**.
2. Click the **Team Lead queue** count tile.

**Option C — Copilot**

1. Open **Copilot**.
2. Ask: *“What approvals are waiting for me?”*

### 9.2 Approve or reject (Section 1 or Section 2)

1. Open the indent.
2. Expand the section marked **Active** (Team Lead Section 1 or 2).
3. Under **Decision**, choose:
   - ○ **Approve**, or  
   - ○ **Reject**
4. In **Remarks (required)**, type a short reason (mandatory).
5. Click **Send**.
6. The page updates. Your decision appears as an “Approved” or “Rejected” stamp.

> If you see **View only — Team Lead must decide**, you are signed in as a different role. Sign out and sign in as Team Leader.

---

## 10. Procurement guide

### 10.1 Open your queue

1. Sign in as Procurement.
2. Click **Queue** (Procurement queue).
3. Click a case to open the indent workspace.

### 10.2 Procurement Section 1 — enquiry, quotes, AI, vendor pick

Work top-to-bottom while the section is **Active**.

#### Step 1 — Vendors & send enquiry

1. Click **Load vendors** (or similar refresh) if the list is empty.
2. Optionally filter vendors with the search box.
3. Tick the vendors you want.
4. Click **Send Gmail** to email the enquiry (only works if Gmail is connected for your environment).
5. If email is not connected, continue by collecting quotes manually (next steps still work).

#### Step 2 — Collect quotations

You can:

- **Upload quote (PDF)** for a vendor, and/or  
- Paste quote text and click **Save text as quotation**

Optional: click **Extract with AI** on a quote row to pull price / lead time from the PDF text.

#### Step 3 — Commercial requirements & AI match

1. Fill **Cost / commercial**, **Delivery**, and **Specifications** requirement fields as needed.
2. Save commercial requirements if a save button is shown.
3. Click **Match with AI**.
4. Review the comparison results (scores, recommendation).

When quotes are complete:

5. Click **Mark quotations ready**.

#### Step 4 — Finalize vendor

1. Review the quote table.
2. Under **Select vendor for Team Lead approval**, choose a vendor.
3. If you are not picking the AI top recommendation, fill **Override reason**.
4. Enter the **approval budget amount** (this controls Director / MD routing).
5. Click **Send**.

The case moves to **Team Lead Section 2**.

### 10.3 After approvals — Procurement Section 2 (PO & Proforma)

When the case reaches PO stage:

1. Expand **Procurement Section 2 — PO & Proforma**.
2. Click **Upload PO (PDF)** and choose the signed PO file.
3. Optional (if Gmail connected): **Send PO to vendor (email)**.
4. Under **Proforma**, upload the vendor proforma PDF and fill details, then save.
5. When ready, click **Send to finance**.

### 10.4 Vendors master list

1. Click **Vendors**.
2. Search if needed.
3. Click **Add** / create to register a vendor (company, email, phone, city, GST, linked items).
4. Use the pencil / edit control to update an existing vendor.
5. Save.

### 10.5 Items master list

1. Click **Items**.
2. Add or edit catalog items (name, SKU, unit, category, specs).
3. Requesters pick from this list when raising indents — keep it up to date.

### 10.6 Documents

1. Click **Documents**.
2. Browse files attached across cases.
3. Download when needed.

---

## 11. Director guide

You act when the vendor approval value is **above ₹50,000** (and the case is in Director stage).

### Steps

1. Sign in as Director.
2. Click **Director approvals**.
3. Open a case from the list.
4. Expand **Director Approval Section** (should show **Active**).
5. Choose **Approve** or **Reject**.
6. Enter **Remarks (required)**.
7. Click **Send**.

You can also open **Indents** to observe lower-value cases in view-only mode.

---

## 12. Managing Director (MD) guide

You act when the vendor approval value is **above ₹5,00,000**, after Director approval.

### Steps

1. Sign in as MD.
2. Click **MD approvals**.
3. Open a case.
4. Expand **MD Approval Section**.
5. Choose **Approve** or **Reject**.
6. Enter **Remarks (required)**.
7. Click **Send**.

---

## 13. Finance guide

### 13.1 Open finance work

1. Sign in as Finance.
2. Click **Payments** (Finance workspace).
3. Open a case from the list.

### 13.2 Complete the accounts section

When finance step is active:

1. Review the **Approval summary** and download PO / proforma if needed.
2. Fill **Accounts section** fields:
   - Budget allocation  
   - Budget utilized  
   - Available balance  
   - Funds available? (Yes / No)  
   - Account No, IFSC, Branch, Account Holder  
   - Remarks  
3. Click **Done**.

Continue with any later finance panels shown on the same page (final invoice / review) until the case reaches **Closed**.

### 13.3 Documents

Use **Documents** in the menu to find payment-related PDFs across cases.

---

## 14. Admin guide

### 14.1 User management

1. Sign in as Admin.
2. Click **User management**.
3. You can:
   - View all users and roles  
   - **Add** a new user (email, username, password, role)  
   - Change a user’s password  
   - Deactivate / delete users (follow on-screen confirmations)  
   - Manage role labels if that panel is shown  

> Admin **cannot** click Approve/Reject as if they were Team Lead, Director, or MD. That separation of duties is intentional.

### 14.2 Other menus

Admin typically also sees Queue, Indents, Vendors, Items, Documents, Payments, Approvals, Copilot, and Notifications for oversight.

---

## 15. Using Copilot (AI assistant)

Copilot is a chat helper that can **look up** your cases and **suggest** next steps. It only changes something after you click **Confirm**.

### 15.1 Open Copilot

1. Click **Copilot** in the left menu.
2. You see the chat area, suggested prompts, and a message box at the bottom.

### 15.2 Ask a question

1. Type in plain language, for example:
   - “Show my pending indents”
   - “What should I do next on my open cases?”
   - “What approvals are waiting for me?”
2. Press Enter or click the send icon.
3. Read the reply. If it shows links (for example an indent reference), click them to open the page.

You can also click a **suggested prompt** chip instead of typing.

### 15.3 Confirm before anything important happens

If Copilot wants to change a case (submit, approve, etc.):

1. A card appears: **Confirmation required**.
2. Read the title and details carefully.
3. Click **Confirm** to apply, or **Cancel** to stop.
4. Never confirm an action you do not understand.

### 15.4 Start a fresh chat

Click **New chat** when you want a clean conversation.

### 15.5 Good habits

- Copilot respects your role — a Requester cannot force an RFQ through chat.
- If Copilot says it cannot help, open the indent page and use the normal buttons.
- Prefer clear prompts that mention the indent reference when you have one.

---

## 16. Notifications

1. Click **Notifications**.
2. Unread items appear highlighted with a small blue dot.
3. Read the title and body.
4. Click **Open case …** to jump to that indent.
5. Use **Mark all read** (top of the page) when you have caught up.

---

## 17. Settings & sign out

### Change password

1. Click your name (top right) → **Settings**.
2. Review your profile (name, email, username, role).
3. Under password change, enter:
   - Current password  
   - New password  
   - Confirm new password  
4. Save.

### Sign out

1. Click your name (top right).
2. Click **Sign out**.
3. You return to the Sign in page.

Always sign out on shared computers.

---

## 18. Reading status badges

On lists and case pages you will see statuses such as:

| You see something like… | Meaning in plain language |
|-------------------------|---------------------------|
| DRAFT | Saved but not sent |
| PENDING TL INDENT | Waiting for Team Lead (first review) |
| REJECTED TL INDENT | Team Lead rejected the request |
| PROCUREMENT ACTIVE / RFQ SENT / AWAITING QUOTES | Procurement is working |
| QUOTES READY | Quotes collected; vendor pick in progress |
| PENDING TL VENDOR | Waiting for Team Lead (vendor review) |
| PENDING DIRECTOR / PENDING MD | Waiting for executive approval |
| PROCUREMENT PO / PO SENT / AWAITING INVOICE | PO / proforma stage |
| PENDING FINANCE / PAYMENT … | Finance is working |
| CLOSED | Finished |

The workflow tracker bar highlights which stage the case is in.

---

## 19. Tips & common problems

| Situation | What to do |
|-----------|------------|
| A button is missing | Wrong role, or the case is not at that stage yet. Check the tracker and the **Active** / **Read only** labels. |
| “View only — … must decide” | Someone else must approve. Wait, or sign in as that role. |
| Upload failed | Use a real PDF only. Avoid special characters in file names. |
| Copilot refused | You asked for something your role cannot do — use the correct account. |
| Confirm expired in Copilot | Ask again, then click Confirm promptly. |
| Gmail send failed | Email integration may be disconnected. Continue with manual PDF uploads. |
| Empty item dropdown when raising indent | Ask Admin/Procurement to add catalog items. |
| Stuck / page looks old | Refresh the browser. Re-open the indent from the list. |
| Need help finding a case | Use Indents search, Notifications, or ask Copilot. |

### Please don’t

- Share passwords or Confirm screenshots that include secrets.  
- Confirm Copilot actions you have not read.  
- Expect Copilot to bypass approvals.  
- Try to use another person’s account.

---

## Quick start checklist (first day)

1. Open the live URL and **Sign in**.  
2. Click **Overview** and note your counts.  
3. Open **Indents** (or your queue).  
4. Open one case and expand the **Active** section.  
5. Try **Copilot** with: “What should I do next?”  
6. Check **Notifications**.  
7. **Sign out** when finished.

---

## Need the technical / evaluator docs?

Those are separate from this manual:

- Product / staging notes: [`README.md`](./README.md)  
- Evaluator walkthrough: [`docs/EVALUATOR_GUIDE.md`](./docs/EVALUATOR_GUIDE.md)  
- Short operator notes: [`deliverables/06_OPERATOR_RUNBOOK.md`](./deliverables/06_OPERATOR_RUNBOOK.md)

---

*MedFlow user manual — written for non-technical business users of the procurement workspace.*
