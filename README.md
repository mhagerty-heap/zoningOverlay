# 🎨 Contentsquare Demo Extension for SCs

A powerful Chrome Extension built specifically for Solutions Consultants (SCs) to customize, persist, and manage zoning and heatmap metrics within the Contentsquare app. 

This tool allows you to seamlessly tailor Contentsquare reports for highly specific, realistic client demonstrations without altering any underlying backend data.

## ✨ Key Features

* **Seamless Metric Editing:** Toggle Edit Mode and click on any zoning element to instantly change its metric name and value.
* **Rock-Solid Persistence:** Edits survive page reloads, date range changes, and device toggles. The extension intelligently strips volatile session tokens (JWTs) to ensure your custom data stays locked to the zone.
* **Side-by-Side Compare Mode:** Full support for Contentsquare's comparison mode. Edits made on the Left Pane stay on the left, and edits on the Right Pane stay on the right, automatically labeled for clarity using Spatial DOM logic.
* **Scenario Management:** Build a perfect demo and save it as a "Scenario." Switch between different narratives with one click.
* **Import & Export:** Export single scenarios or entire batches as JSON files to share with other SCs on your team.
* **Advanced Exposure Gradients:** Use the Advanced menu to auto-seed realistic, descending Exposure Rate gradients above and below the fold.
* **Context-Aware UI:** The extension UI automatically detects and displays the specific Contentsquare Report ID you are currently modifying to prevent cross-client confusion.

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
* Click the **CS Demo** button in your browser toolbar to open the extension menu.
* Toggle **Editing** to **ON**.
* Click on any metric on the page. A popover will appear allowing you to change the value and the metric name.
* Edits apply instantly and persist on reload.

### 2. Managing Scenarios
Scenarios allow you to save your current page state (all zoning and heatmap edits) into a single, clickable profile.
* Click **Scenarios** in the top extension menu.
* Type a name (e.g., "Retail Pitch - High Cart Abandonment") and click **Save**.
* Click **Load** next to any saved scenario to instantly overwrite the page with those edits.
* **Sharing:** Click the **⬇ (Export)** button next to a specific scenario to download it as a `.json` file, or click **⬇ Export All** to download every scenario tied to the current report. Use **⬆ Import** to load scenarios built by other SCs.

### 3. Reviewing Active Edits
* Click the orange **"X edits"** button in the top menu to view a list of all currently modified zones.
* The menu shows the original value, the new value, and automatically tags if the edit is on the Left Pane or Right Pane.
* Click **Delete** next to any row to revert that specific zone to its original, true data.

### 4. Advanced Auto-Exposure
Need to quickly make a realistic exposure map? 
* Click **Advanced** in the top menu.
* Set your Top % and Bottom % bounds (e.g., 100% at the top of the page, bleeding down to 20% at the bottom).
* Click **Apply Exposure Gradient** to automatically math out and apply descending values to all zones based on their physical location relative to the browser fold.

---

## 🔧 Under the Hood (For Developers)

* **Iframe Piercing & CORS:** Contentsquare renders reports inside isolated subdomains (`snapshot.contentsquare.com`). The extension relies on a secure message bridge to pass data (like absolute `screenX` mouse coordinates) between the iframe and the top-level window to bypass cross-origin restrictions.
* **Stable Key Generation:** Zone IDs are generated using a combination of the top-level report ID, the physical pane geometry, and DOM hierarchies. `location.hash` data is explicitly stripped during generation, as Contentsquare injects volatile JWTs that break standard persistence.
* **Spatial Math:** To accurately label metrics in side-by-side comparison mode, the extension calculates the physical `getBoundingClientRect()` center-point of clicked zones to determine their relation to the viewport center, avoiding reliance on hidden 100%-width wrapper elements.