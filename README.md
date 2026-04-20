# CS Demo Tool

A Chrome extension designed for PreSales and Solution Consulting teams to easily mock up and modify analysis data directly in the browser.

## Features

* **Live Editing**: Click on any zone in the Zoning module to instantly change its metric value and display text.
* **Color Matching**: Automatically updates the zone's background color gradient to match the new value.
* **Heatmap Point Mocking**: Shift + Click anywhere on the page to drop custom heatmap points (clicks, hovers, etc.).
* **Journey Analysis Manipulation**: Rename nodes and alter traffic distribution percentages in Sunburst charts to build the perfect "Golden Path" narrative.
* **Advanced Data Generation**: Instantly build realistic, multi-metric data stories across the entire page without having to manually edit every zone.
* **Persistent Overrides**: Your mocked data stays applied even if you toggle between different metrics or scroll down the page.
* **Export/Import**: Save your mocked scenarios as JSON files and load them up right before a demo.

## Installation

1.  Download or clone this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** in the top right corner.
4.  Click **"Load unpacked"** and select the folder containing the extension files.

## Usage

1.  Navigate to an analysis module inside the platform.
2.  The extension will automatically inject a toolbar at the top right of your screen.
3.  Toggle **"Edit Zones"** to enable interaction.
4.  **Click** on any highlighted zone to open the editor popover and enter a new value.
5.  **Add Heatmap Points**: With Edit Mode ON and the page set to Heatmap view, simply **Click** anywhere on the page to drop a fake heatmap interaction point. A popover will appear to let you configure the click volume and intensity.

### Advanced Tools

Click the **"Advanced"** button in the toolbar to access bulk operations and Journey features. The menu is divided into two master tabs: **Zoning** and **Journeys**.

**⚠️ Important:** The "Edit Zones" toggle must be turned **ON** to unlock and use these features.

#### The Zoning Tab
* **1. Bulk Fill Current Metric**: Instantly populate all un-edited zones on the screen with data for the metric you are currently viewing. You can choose to overwrite existing native data (>0) or only fill the blanks. Data is scaled between your chosen Min and Max values.
* **2. Global Metric Library (360° Data Generation)**: The ultimate demo builder. Set Min/Max bounds for *every* metric in the library (Revenue, Click Rate, Attractiveness, Time, etc.). Clicking **🚀 Generate All Data** injects tailored data for every single metric into all visible zones simultaneously. 
* **3. Exposure Auto-Seed Bounds**: Quickly build a realistic "scroll depth" narrative. Defines a Top % and Bottom % for exposure. Zones above the fold are automatically assigned the Top %, and zones below the fold gradually decrease toward the Bottom %.

#### The Journeys Tab
* **Journey Node Editor**: Tailor the story of your Sunburst charts in the Journey Analysis module.
  * **Target & Rename**: Select any node in the current journey from the dropdown and instantly rename it visually on the screen (e.g., "Homepage" -> "Target Campaign Landing").
  * **Traffic Manipulation**: Inflate or deflate the percentage of traffic flowing through a specific node. The extension mathematically resizes the Sunburst arcs to match your target percentage.
  * **Side-by-Side Compare**: Explicitly target the Left Pane or Right Pane to show distinct A/B behaviors for the exact same node.

### Toolbar Options

* **Scenarios**: Open the scenario manager to Save, Load, Export, or Import your data configurations.
* **Reset All**: Clears all mocked data (Zoning, Heatmaps, and Journeys) and restores the page to the native values.

## Important Notes

* This extension works by manipulating the DOM locally and intercepting network requests in your browser. It **does not** send any data to servers or permanently alter the actual analysis.
* If the page structure changes significantly, you may need to re-apply or adjust your mocked zones.
* The "Edit Zones" toggle must be turned **ON** to unlock and use features.
* **Journey Chart Updates**: When applying size/percentage rules to Journey Analysis, you must trigger a "soft reload" (like toggling the date range in the UI) for the chart's structural math to fetch and update. Text renaming will happen automatically.
* Data generated in Compare Mode is strictly tied to the split-screen view. Your edits will not carry over if you toggle back to a single screen (and vice versa)!