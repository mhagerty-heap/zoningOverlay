#  Zoning Demo Tool

A Chrome extension designed for PreSales and Solution Consulting teams to easily mock up and modify Zoning analysis data directly in the browser.

## Features

* **Live Editing**: Click on any zone in the  Zoning module to instantly change its metric value and display text.
* **Color Matching**: Automatically updates the zone's background color gradient to match the new value.
* **Heatmap Point Mocking**: Shift + Click anywhere on the page to drop custom heatmap points (clicks, hovers, etc.).
* **Advanced Data Generation**: Instantly build realistic, multi-metric data stories across the entire page without having to manually edit every zone.
* **Persistent Overrides**: Your mocked data stays applied even if you toggle between different metrics or scroll down the page.
* **Export/Import**: Save your mocked scenarios as JSON files and load them up right before a demo.

## Installation

1.  Download or clone this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** in the top right corner.
4.  Click **"Load unpacked"** and select the folder containing the extension files.

## Usage

1.  Navigate to a Zoning analysis inside the  platform.
2.  The extension will automatically inject a toolbar at the bottom of your screen.
3.  Toggle **"Edit Zones"** to enable interaction.
4.  **Click** on any highlighted zone to open the editor popover and enter a new value.
5.  **Add Heatmap Points**: With Edit Mode ON and the page set to Heatmap view, simply **Click** anywhere on the page to drop a fake heatmap interaction point. A popover will appear to let you configure the click volume and intensity.

### Advanced Tools

Click the **"Advanced"** button in the toolbar to access bulk operations. 

**⚠️ Important:** The "Edit Zones" toggle must be turned **ON** to unlock and use these features.

* **1. Bulk Fill Current Metric**: Instantly populate all un-edited zones on the screen with data for the metric you are currently viewing. It leaves your manually edited zones alone, but fills all the empty/native zones with scaled data between your chosen Min and Max values.
* **2. Global Metric Library Tuner (360° Data Generation)**: The ultimate demo builder. Instead of generating data for just one metric, this allows you to set Min/Max bounds for *every* metric in the library (Revenue, Click Rate, Attractiveness, Time, etc.). Clicking **🚀 Generate All Data** injects tailored data for every single metric into all visible zones simultaneously. You can then seamlessly switch between metrics in the  UI dropdown, and the extension will instantly swap the data on screen to match the active tab!
* **3. Exposure Auto-Seed Bounds**: Quickly build a realistic "scroll depth" narrative. Defines a Top % and Bottom % for exposure. Zones above the fold are automatically assigned the Top %, and zones below the fold gradually decrease toward the Bottom % the further down the page they go. Smartly handles side-by-side compare modes as well.

**⚠️ Important:** Note on Compare Mode: Data generated in Compare Mode is strictly tied to the split-screen view. Your edits will not carry over if you toggle back to a single screen (and vice versa)!

### Toolbar Options

* **Export**: Downloads your current mocked data as a `.json` file.
* **Import**: Loads a previously saved `.json` file.
* **Reset All**: Clears all mocked data and restores the page to the native  values.

## Important Notes

* This extension works by manipulating the DOM locally in your browser. It **does not** send any data to  servers or permanently alter the actual analysis.
* If the page structure changes significantly, you may need to re-apply or adjust your mocked zones.