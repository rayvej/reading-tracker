# Reading Tracker Standard Calculation Rules & Methodology

This document serves as the single source of truth for how **Books Read**, **Pages Read**, **Titles**, **Progress**, and **Rereads** are calculated across the Reading Tracker application.

---

## 1. Standard Metrics Definitions

### A. Books Read (Completed Reading Cycles)
- **Definition**: The total number of times any book has been read to completion.
- **Formula**:
  $$\text{Books Read} = \sum_{b \in \text{Books}} \max\left(\text{read\_count}_b, \text{is\_finished}_b ? 1 : 0\right)$$
- **Current Value**: **65 Books Read** (61 unique finished titles + 4 re-reads).
- **Rule**: If a book has been read twice (`read_count = 2`), it counts as **2 completed reads**.

### B. Titles Summary
- **Definition**: The breakdown of unique titles in the catalog by reading state.
- **Formulas**:
  - **Total Titles**: Count of all books in catalog (**158 Titles**).
  - **Finished Titles**: Count of unique books with `status` in `['Finished', 'Owned and Read', 'Borrowed and Read']` or `read_count > 0` (**61 Titles**).
  - **Active Titles**: Count of unique books currently `status = 'In Progress'` (**4 Titles**).
  - **Unread Titles**: Count of books not yet started (**93 Titles**).

### C. Total Pages Read (Lifetime Logged)
- **Definition**: The cumulative sum of all pages read across all finished cycles plus active reading progress on in-progress titles.
- **Formula**:
  $$\text{Total Pages Read} = \sum_{b \in \text{Finished}} \left(\text{read\_count}_b \times \text{total\_pages}_b\right) + \sum_{b \in \text{In Progress}} \left( (\text{read\_count}_b \times \text{total\_pages}_b) + \text{active\_progress}_b \right)$$
- **Active Progress Calculation**:
  - For any book `b` in progress on cycle $C = \text{read\_count}_b + 1$:
    $$\text{active\_progress}_b = \max\left(\{ \text{l.end\_page} \mid l \in \text{Logs for Book } b, l.\text{read\_cycle} = C \}\right) \pmod{\text{total\_pages}_b}$$
- **Current Value**: **15,500 Pages Read** ($15,174$ finished cycle pages $+ 326$ active in-progress pages).

---

## 2. Comprehensive Catalog Audit & Breakdown

### Finished Books (61 Titles / 65 Completed Reads / 15,174 Pages)
| Book Title | Edition Pages | Read Count | Total Pages Contributed |
| :--- | :---: | :---: | :---: |
| A Companion to the Study of the Kitáb-i-Íqán/S | 291 | 1 | 291 |
| A Manual for Pioneers/S | 287 | 1 | 287 |
| A Traveler’s Narrative | 94 | 1 | 94 |
| ‘Abdu’l-Bahá the Master/S | 80 | 1 | 80 |
| ‘Abdu’l-Bahá: The Centre of the Covenant | 560 | 1 | 560 |
| Ásíyih Khánum - The Most Exalted Leaf Entitled Navváb/S | 92 | 1 | 92 |
| Bahá’í Administration | 196 | 1 | 196 |
| Bahá’u’lláh and the New Era | 312 | 1 | 312 |
| Bahá’u’lláh - The King of Glory | 436 | 1 | 436 |
| Citadel of Faith | 198 | 1 | 198 |
| Constitution of the Universal House of Justice/S | 10 | 1 | 10 |
| Epistle to the Son of the Wolf | 181 | 1 | 181 |
| Five Year Plan and the One Year Plan, 2016-2022 | 183 | 1 | 183 |
| **Gems of Divine Mysteries** | 50 | **2** | **100** |
| Gleanings from the Writings of Bahá’u’lláh | 286 | 1 | 286 |
| God Passes By | 412 | 1 | 412 |
| Khadíjih Bagum: Wife of the Báb/S | 40 | 1 | 40 |
| Khánum - The Greatest Holy Leaf/S | 40 | 1 | 40 |
| Light of the World | 207 | 1 | 207 |
| Martha Root | 496 | 1 | 496 |
| Memorials of the Faithful | 203 | 1 | 203 |
| Messages of Shoghi Effendi to the Indian Subcontinent | 469 | 1 | 469 |
| Messages to the Bahá’í World | 175 | 1 | 175 |
| Mírzá Mihdí The Purest Branch/S | 282 | 1 | 282 |
| On the Wings of Angels | 108 | 1 | 108 |
| Prayers and Meditations | 284 | 1 | 284 |
| Prescription for Living/S | 256 | 1 | 256 |
| Revelation of Bahá’u’lláh - Vol 1 | 355 | 1 | 355 |
| Revelation of Bahá’u’lláh - Vol 4 | 431 | 1 | 431 |
| Selections from the Writings of ‘Abdu’l-Bahá | 333 | 1 | 333 |
| Selections from the Writings of the Báb | 224 | 1 | 224 |
| **Some Answered Questions** | 352 | **2** | **704** |
| Tablets of Bahá’u’lláh revealed after the Kitáb-i-Aqdas | 247 | 1 | 247 |
| Tablets of the Divine Plan | 107 | 1 | 107 |
| Text for the Study of the Covenant | 122 | 1 | 122 |
| The Advent of Divine Justice | 138 | 1 | 138 |
| The Call of the Divine Beloved | 102 | 1 | 102 |
| The Covenant of Bahá’u’lláh | 449 | 1 | 449 |
| The Covenant: Daily Readings/H | 383 | 1 | 383 |
| **The Dawn-Breakers** | 668 | **2** | **1,336** |
| The Hidden Words | 52 | 1 | 52 |
| The Kitáb-i-Aqdas | 266 | 1 | 266 |
| **The Kitáb-i-Íqán** | 291 | **2** | **582** |
| The Nine Year Plan 2022 - 2031 | 109 | 1 | 109 |
| The Prince of Martyrs | 68 | 1 | 68 |
| The Promised Day is Come | 204 | 1 | 204 |
| The Secret of Divine Civilization | 116 | 1 | 116 |
| The Summons of the Lord of Hosts | 235 | 1 | 235 |
| The Tabernacle of Unity | 64 | 1 | 64 |
| The World Order of Bahá’u’lláh | 206 | 1 | 206 |
| Thief in the Night/S | 308 | 1 | 308 |
| This Decisive Hour | 135 | 1 | 135 |
| To Set the World in Order | 84 | 1 | 84 |
| Training Institute: Attaining a Higher Level of Functioning | 25 | 1 | 25 |
| Vignettes from the Life of ‘Abdu’l-Bahá/S | 238 | 1 | 238 |
| Will and Testament of ‘Abdu’l-Bahá | 26 | 1 | 26 |
| Etiquette Guide to China | 192 | 1 | 192 |
| Leap: How to Thrive in a World Where Everything Can Be Copied | 258 | 1 | 258 |
| The Alchemist | 182 | 1 | 182 |
| The Iliad | 414 | 1 | 414 |
| tuesdays with Morrie | 201 | 1 | 201 |
| **Subtotal Finished Books** | **—** | **65 Reads** | **15,174 Pages** |

---

### In-Progress Books (4 Active Titles / 326 Active Pages)
| Book Title | Past Reads | Total Pages | Current Page Read | Active Pages Contributed |
| :--- | :---: | :---: | :---: | :---: |
| **The Dawn-Breakers** (Cycle 3 Re-read) | 2 | 668 | 108 | 108 |
| **A Short History of Nearly Everything** | 0 | 560 | 142 | 142 |
| **The Promulgation of Universal Peace** | 0 | 707 | 70 | 70 |
| **Bahá’í Sacred Writings** | 0 | 489 | 6 | 6 |
| **Subtotal Active Progress** | **—** | **—** | **—** | **326 Pages** |

---

## 3. Reconciliation & Totals Summary

| Metric | Official Count |
| :--- | :---: |
| **Total Catalog Titles** | **158** |
| **Finished Titles** | **61** |
| **Active In-Progress Titles** | **4** |
| **Total Books Read (Completed Cycles)** | **65** |
| **Finished Cycles Pages** | **15,174** |
| **Active Cycle In-Progress Pages** | **326** |
| **GRAND TOTAL LIFETIME PAGES READ** | **15,500** |

---

## 4. Engineering Guardrails in `docs/app.js`

To prevent future desynchronization:
1. **Unified Formula**: `getReconciledStats('all')` MUST ALWAYS compute pages using the exact formula specified in Section 1C.
2. **Active Progress Isolation**: Active cycle page progress MUST NEVER be added on top of a stale `pages_read` field if daily logs for that cycle exist.
3. **Edition Total Consistency**: Updating `total_pages` for a book updates all past completed cycle page counts dynamically ($rc \times \text{total\_pages}$) to maintain proportional accuracy across edition changes.
