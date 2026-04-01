# 🎨 Contentsquare Demo Extension for SCs

A powerful Chrome Extension built specifically for Solutions Consultants (SCs) to customize, persist, and manage zoning and heatmap metrics within the Contentsquare app. 

This tool allows you to seamlessly tailor Contentsquare reports for highly specific, realistic client demonstrations without altering any underlying backend data.

## ✨ Key Features

* **Seamless Metric Editing:** Toggle Edit Mode and click on any zoning element to instantly change its metric name and value.
* **Bulk Data Generation:** Rapidly populate "dead" pages with realistic, intelligently formatted gradients for any metric (Clicks, Revenue, Recurrence, etc.).
* **Rock-Solid Persistence:** Edits survive page reloads, date range changes, and device toggles. The extension intelligently strips volatile session tokens (JWTs) to ensure your custom data stays locked to the zone.
* **Side-by-Side Compare Mode:** Full support for Contentsquare's comparison mode. Edits made on the Left Pane stay on the left, and edits on the Right Pane stay on the right.
* **Scenario Management:** Build a perfect demo and save it as a "Scenario." Switch between different narratives with one click.
* **Import & Export:** Export single scenarios or entire batches as JSON files to share with other SCs on your team.
* **Context-Aware UI:** The extension UI automatically detects and displays the specific Contentsquare Report ID you are currently modifying.

---

## 🛠 Installation

Currently, this extension is loaded as an "unpacked" developer extension.

1. Download or clone this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. In the top right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top left.
5. Select the folder containing your extension files (where `manifest.json` is located).
6. *Optional:* Pin the extension to your Chrome toolbar for easy access.

---

## 📖 How to Use

### 1. Editing Zones
* Open a Contentsquare Zoning report.
* Click the **CS Demo** button in your browser toolbar and toggle **Editing** to **ON**.
* Click on any metric on the page to open the edit popover. Changes apply instantly and persist on reload.

### 2. Bulk Fill & Advanced Tools (The "Advanced" Menu)
The Advanced menu provides automated tools to seed data across the entire page:

* **Bulk Fill Current Metric:** Use this to populate all zones currently showing `0`, `0.00%`, or `N/A`. 
    * Set a **Max** and **Min** value; the tool sorts zones top-to-bottom and applies a descending gradient.
    * **Smart Formatting:** It automatically detects if it should apply `%`, `$`, or decimal places (e.g., for Recurrence) based on the existing page context.
* **Exposure Auto-Seed:** Specialized coordinate-based logic. It uses the browser's "Fold" line to set 100% exposure above the fold and a pixel-perfect drop-off below the fold.

### 3. Managing Scenarios
* Click **Scenarios** in the top extension menu.
* Save your current setup (e.g., "Checkout Friction Story") to load it later or share it.
* **Sharing:** Use the **Export** button to share `.json` scenarios with teammates. They can use **Import** to see exactly what you built.

### 4. Reviewing and Resetting Edits
* Click the orange **"X edits"** button to see a list of every modification on the current view.
* **Delete:** Remove specific edits individually.
* **Reset All:** Use the main "Reset All" button to perform a deep-clean of the DOM, removing all injected metrics, background values, and edited styles to return to the native client data.

---

## ⚖️ When to use which Auto-Populate?

| Feature | Logic Type | Best Metric For... |
| :--- | :--- | :--- |
| **Bulk Fill** | **Rank-Based** (1st, 2nd, 3rd...) | Click Rate, Revenue, Conversion, Recurrence, Activity. |
| **Exposure Seed** | **Pixel-Based** (Distance from Fold) | Exposure Rate, Visibility. |

---

## 🔧 Under the Hood (For Developers)

* **Iframe Piercing & Messaging:** Contentsquare renders reports inside isolated subdomains. The extension uses a `chrome.runtime` message bridge to broadcast commands (like Bulk Fill or Reset) from the UI into the site-iframe.
* **Stable Key Generation:** Zone IDs are generated using a combination of the report ID, pane geometry, and DOM hierarchies. `location.hash` data is stripped to avoid breaking persistence with volatile JWTs.
* **DOM Sanitization:** The "Reset All" function targets `data-cs-demo-orig` attributes to ensure that background `value` attributes (used by CS for heatmap coloring) are fully restored or removed, preventing "state leaks" between bulk edits.
* **Smart Formatter:** The formatting engine uses regex sniffing to detect currency symbols, percent signs, and decimal patterns (like `N/A` or `1.00`) to ensure generated data looks native to the specific metric selected.