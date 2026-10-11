/**
 * Fictional demo master data for "Northstar Precision Manufacturing".
 * All companies, people and products are invented for demonstration.
 */

export const NORTHSTAR = {
  name: "Northstar Precision Manufacturing",
  slug: "northstar",
  timezone: "America/Chicago",
};

export const COBALT = {
  name: "Cobalt Ridge Fabrication",
  slug: "cobalt-ridge",
  timezone: "America/Denver",
};

export const PEOPLE = [
  { key: "avery", email: "avery.chen@northstar.example", name: "Avery Chen", title: "Systems Administrator", role: "admin" },
  { key: "jordan", email: "jordan.patel@northstar.example", name: "Jordan Patel", title: "Operations Manager", role: "manager" },
  { key: "riley", email: "riley.morgan@northstar.example", name: "Riley Morgan", title: "Production Planner", role: "planner" },
  { key: "sam", email: "sam.okafor@northstar.example", name: "Sam Okafor", title: "Warehouse Lead", role: "warehouse" },
  { key: "taylor", email: "taylor.brooks@northstar.example", name: "Taylor Brooks", title: "Sales Coordinator", role: "sales" },
  { key: "casey", email: "casey.nguyen@northstar.example", name: "Casey Nguyen", title: "Quality Engineer", role: "quality" },
  { key: "morgan", email: "morgan.diaz@northstar.example", name: "Morgan Diaz", title: "Controller", role: "finance" },
  { key: "jamie", email: "jamie.fischer@northstar.example", name: "Jamie Fischer", title: "Internal Auditor", role: "viewer" },
] as const;

export type PersonKey = (typeof PEOPLE)[number]["key"];

export const SITES = [
  { code: "MPL", name: "Minneapolis Electronics Plant", address: "1200 Foundry Ave, Minneapolis, MN" },
  { code: "RST", name: "Rochester Assembly Plant", address: "48 Prairie Works Rd, Rochester, MN" },
] as const;

export const WAREHOUSES = [
  { code: "MPL-STORES", name: "Minneapolis Stores", site: "MPL", kind: "stores", bins: ["A-01", "A-02", "B-01", "B-02", "RECV"] },
  { code: "MPL-FG", name: "Minneapolis Finished Goods", site: "MPL", kind: "finished_goods", bins: ["FG-01", "FG-02", "SHIP"] },
  { code: "RST-MAIN", name: "Rochester Main Warehouse", site: "RST", kind: "general", bins: ["R-01", "R-02", "R-03", "DOCK"] },
] as const;

export const WORK_CENTERS = [
  { code: "SMT-1", name: "SMT Line 1", site: "MPL", kind: "smt", rate: "95", hours: "16" },
  { code: "ASM-M", name: "Manual Assembly — Minneapolis", site: "MPL", kind: "assembly", rate: "55", hours: "16" },
  { code: "TEST-M", name: "Test & Inspection — Minneapolis", site: "MPL", kind: "test", rate: "65", hours: "8" },
  { code: "PACK-M", name: "Pack-out — Minneapolis", site: "MPL", kind: "packaging", rate: "40", hours: "8" },
  { code: "SMT-2", name: "SMT Line 2", site: "RST", kind: "smt", rate: "95", hours: "8" },
  { code: "MCH-R", name: "Machining Cell — Rochester", site: "RST", kind: "machining", rate: "85", hours: "16" },
  { code: "ASM-R", name: "Final Assembly — Rochester", site: "RST", kind: "assembly", rate: "58", hours: "16" },
  { code: "TEST-R", name: "Functional Test — Rochester", site: "RST", kind: "test", rate: "65", hours: "8" },
] as const;

export const SUPPLIERS = [
  { code: "ARC", name: "Arcwell Electronics Supply", contact: "Dana Whitfield", terms: 30, lead: 21, rating: "4.6" },
  { code: "BPF", name: "Brightline PCB Fabrication", contact: "Kofi Mensah", terms: 45, lead: 18, rating: "4.2" },
  { code: "CVM", name: "Cedar Valley Metals", contact: "Lena Sorensen", terms: 30, lead: 14, rating: "4.4" },
  { code: "DRP", name: "Delta Ridge Plastics", contact: "Marco Ruiz", terms: 30, lead: 10, rating: "3.9" },
  { code: "EVF", name: "Everstone Fasteners", contact: "Priya Raman", terms: 30, lead: 7, rating: "4.8" },
  { code: "FMP", name: "Fairmont Packaging", contact: "Hollis Grant", terms: 30, lead: 6, rating: "4.5" },
  { code: "GPS", name: "Granite Peak Sensors", contact: "Ivy Tran", terms: 45, lead: 28, rating: "4.1" },
  { code: "HCW", name: "Harbor Cable & Wire", contact: "Nate Abernathy", terms: 30, lead: 12, rating: "4.3" },
  { code: "IPS", name: "Ironwood Power Systems", contact: "Rosa Delgado", terms: 45, lead: 24, rating: "4.0" },
  { code: "JDT", name: "Juniper Display Technologies", contact: "Theo Lindqvist", terms: 30, lead: 30, rating: "3.8" },
] as const;

export const CUSTOMERS = [
  { code: "AWU", name: "Aurora Water Utilities", segment: "Utilities", terms: 30, credit: "250000" },
  { code: "BAS", name: "Bluestem Agricultural Systems", segment: "Agriculture", terms: 30, credit: "180000" },
  { code: "CHS", name: "Clearfield HVAC Services", segment: "HVAC", terms: 30, credit: "120000" },
  { code: "DME", name: "Driftwood Marine Equipment", segment: "Marine", terms: 45, credit: "90000" },
  { code: "EPC", name: "Evergreen Process Controls", segment: "Process industry", terms: 30, credit: "300000" },
  { code: "FIC", name: "Foxhollow Irrigation Co.", segment: "Agriculture", terms: 30, credit: "75000" },
  { code: "GBF", name: "Glacier Bay Facilities", segment: "Building automation", terms: 30, credit: "110000" },
  { code: "HIP", name: "Highmark Industrial Pumps", segment: "OEM", terms: 45, credit: "400000" },
  { code: "IMS", name: "Ironbridge Municipal Services", segment: "Utilities", terms: 60, credit: "200000" },
  { code: "KFS", name: "Keystone Fluid Systems", segment: "OEM", terms: 30, credit: "260000" },
  { code: "LMD", name: "Lakeshore Medical Devices", segment: "Medical device OEM", terms: 45, credit: "150000" },
  { code: "MBA", name: "Meridian Building Automation", segment: "Building automation", terms: 30, credit: "140000" },
] as const;

type Wh = "MPL-STORES" | "MPL-FG" | "RST-MAIN";

export interface SeedItem {
  sku: string;
  name: string;
  category: string;
  type: "purchased" | "manufactured";
  uom?: string;
  cost?: string;
  price?: string;
  supplier?: string;
  lead: number;
  moq: string;
  tracking?: "none" | "lot";
  shelfLife?: number;
  family?: string;
  wh: Wh;
}

export const ITEMS: SeedItem[] = [
  // Finished goods
  { sku: "FG-ECM100", name: "ECM-100 Electronic Control Module", category: "Finished Good", type: "manufactured", price: "185.00", lead: 5, moq: "40", tracking: "lot", family: "Control Modules", wh: "MPL-FG" },
  { sku: "FG-ECM200", name: "ECM-200 Dual-Channel Control Module", category: "Finished Good", type: "manufactured", price: "268.00", lead: 6, moq: "25", tracking: "lot", family: "Control Modules", wh: "MPL-FG" },
  { sku: "FG-SNS310", name: "SNS-310 Pressure Sensor Assembly", category: "Finished Good", type: "manufactured", price: "142.00", lead: 6, moq: "30", tracking: "lot", family: "Sensor Assemblies", wh: "MPL-FG" },
  { sku: "FG-SNS420", name: "SNS-420 Temperature Sensor Assembly", category: "Finished Good", type: "manufactured", price: "118.00", lead: 5, moq: "30", tracking: "lot", family: "Sensor Assemblies", wh: "MPL-FG" },
  { sku: "FG-CALKIT", name: "CK-10 Field Calibration Kit", category: "Finished Good", type: "manufactured", price: "96.00", lead: 3, moq: "10", tracking: "lot", family: "Sensor Assemblies", wh: "MPL-FG" },
  { sku: "FG-PMC500", name: "PMC-500 Industrial Pump Controller", category: "Finished Good", type: "manufactured", price: "890.00", lead: 8, moq: "10", tracking: "lot", family: "Pump Controllers", wh: "RST-MAIN" },
  { sku: "FG-PMC750", name: "PMC-750 Variable-Speed Pump Controller", category: "Finished Good", type: "manufactured", price: "1450.00", lead: 10, moq: "6", tracking: "lot", family: "Pump Controllers", wh: "RST-MAIN" },
  // Subassemblies
  { sku: "SA-PCB100", name: "Control board assembly, single channel", category: "Subassembly", type: "manufactured", lead: 4, moq: "60", tracking: "lot", family: "Control Modules", wh: "MPL-STORES" },
  { sku: "SA-PCB200", name: "Control board assembly, dual channel", category: "Subassembly", type: "manufactured", lead: 4, moq: "30", tracking: "lot", family: "Control Modules", wh: "MPL-STORES" },
  { sku: "SA-PCB300", name: "Pump controller logic board", category: "Subassembly", type: "manufactured", lead: 5, moq: "15", tracking: "lot", family: "Pump Controllers", wh: "RST-MAIN" },
  { sku: "SA-PSU24", name: "24 V power supply module", category: "Subassembly", type: "manufactured", lead: 4, moq: "50", tracking: "none", family: "Control Modules", wh: "MPL-STORES" },
  { sku: "SA-SNSHEAD", name: "Pressure sensing head assembly", category: "Subassembly", type: "manufactured", lead: 5, moq: "30", tracking: "lot", family: "Sensor Assemblies", wh: "MPL-STORES" },
  { sku: "SA-HMI", name: "HMI display module", category: "Subassembly", type: "manufactured", lead: 3, moq: "15", tracking: "none", family: "Pump Controllers", wh: "RST-MAIN" },
  { sku: "SA-PMCBASE", name: "Pump controller chassis assembly", category: "Subassembly", type: "manufactured", lead: 6, moq: "15", tracking: "none", family: "Pump Controllers", wh: "RST-MAIN" },
  // Electronics
  { sku: "IC-MCU32", name: "32-bit microcontroller, 64-pin", category: "Electronic Component", type: "purchased", cost: "6.85", supplier: "ARC", lead: 28, moq: "200", tracking: "lot", wh: "MPL-STORES" },
  { sku: "IC-DRV-H", name: "Half-bridge gate driver IC", category: "Electronic Component", type: "purchased", cost: "2.40", supplier: "ARC", lead: 21, moq: "200", tracking: "lot", wh: "MPL-STORES" },
  { sku: "IC-ADC24", name: "24-bit ADC, 4-channel", category: "Electronic Component", type: "purchased", cost: "8.90", supplier: "ARC", lead: 35, moq: "150", tracking: "lot", wh: "MPL-STORES" },
  { sku: "IC-PSUCTL", name: "Flyback controller IC", category: "Electronic Component", type: "purchased", cost: "1.75", supplier: "ARC", lead: 21, moq: "200", tracking: "lot", wh: "MPL-STORES" },
  { sku: "CAP-100N", name: "Capacitor 100 nF 0402", category: "Electronic Component", type: "purchased", cost: "0.0120", supplier: "ARC", lead: 14, moq: "10000", wh: "MPL-STORES" },
  { sku: "CAP-10U", name: "Capacitor 10 µF 0805", category: "Electronic Component", type: "purchased", cost: "0.0450", supplier: "ARC", lead: 14, moq: "4000", wh: "MPL-STORES" },
  { sku: "RES-10K", name: "Resistor 10 kΩ 0603", category: "Electronic Component", type: "purchased", cost: "0.0040", supplier: "ARC", lead: 10, moq: "10000", wh: "MPL-STORES" },
  { sku: "RES-1K", name: "Resistor 1 kΩ 0603", category: "Electronic Component", type: "purchased", cost: "0.0040", supplier: "ARC", lead: 10, moq: "10000", wh: "MPL-STORES" },
  { sku: "MOSFET-60V", name: "Power MOSFET 60 V", category: "Electronic Component", type: "purchased", cost: "0.62", supplier: "ARC", lead: 21, moq: "500", wh: "MPL-STORES" },
  { sku: "XFMR-FLY", name: "Flyback transformer, 24 V", category: "Electronic Component", type: "purchased", cost: "5.30", supplier: "IPS", lead: 24, moq: "100", tracking: "lot", wh: "MPL-STORES" },
  { sku: "CON-M12", name: "M12 4-pin panel connector", category: "Electronic Component", type: "purchased", cost: "4.20", supplier: "HCW", lead: 12, moq: "100", wh: "MPL-STORES" },
  { sku: "CON-TB8", name: "8-position terminal block", category: "Electronic Component", type: "purchased", cost: "1.95", supplier: "HCW", lead: 12, moq: "100", wh: "RST-MAIN" },
  { sku: "RLY-30A", name: "Power relay, 30 A", category: "Electronic Component", type: "purchased", cost: "6.40", supplier: "IPS", lead: 18, moq: "50", tracking: "lot", wh: "RST-MAIN" },
  { sku: "PCB-100", name: "Bare PCB, single channel, 4-layer", category: "Printed Circuit Board", type: "purchased", cost: "3.80", supplier: "BPF", lead: 18, moq: "200", tracking: "lot", wh: "MPL-STORES" },
  { sku: "PCB-200", name: "Bare PCB, dual channel, 6-layer", category: "Printed Circuit Board", type: "purchased", cost: "7.90", supplier: "BPF", lead: 18, moq: "100", tracking: "lot", wh: "MPL-STORES" },
  { sku: "PCB-300", name: "Bare PCB, pump logic, 6-layer", category: "Printed Circuit Board", type: "purchased", cost: "9.40", supplier: "BPF", lead: 18, moq: "50", tracking: "lot", wh: "RST-MAIN" },
  { sku: "LCD-43", name: "4.3-inch TFT display", category: "Electronic Component", type: "purchased", cost: "21.50", supplier: "JDT", lead: 30, moq: "40", tracking: "lot", wh: "RST-MAIN" },
  // Mechanical
  { sku: "ENC-ALU-S", name: "Aluminum enclosure, small", category: "Mechanical", type: "purchased", cost: "11.25", supplier: "CVM", lead: 14, moq: "100", wh: "MPL-STORES" },
  { sku: "ENC-ALU-L", name: "Aluminum enclosure, large", category: "Mechanical", type: "purchased", cost: "38.00", supplier: "CVM", lead: 14, moq: "25", wh: "RST-MAIN" },
  { sku: "HSG-SNS", name: "Stainless sensor housing, 316L", category: "Mechanical", type: "purchased", cost: "14.60", supplier: "CVM", lead: 16, moq: "60", tracking: "lot", wh: "MPL-STORES" },
  { sku: "DIAPH-316", name: "Stainless diaphragm, 316L", category: "Mechanical", type: "purchased", cost: "9.75", supplier: "CVM", lead: 16, moq: "60", tracking: "lot", wh: "MPL-STORES" },
  { sku: "THERMOWELL", name: "Stainless thermowell, 100 mm", category: "Mechanical", type: "purchased", cost: "12.30", supplier: "CVM", lead: 16, moq: "60", wh: "MPL-STORES" },
  { sku: "HEATSINK", name: "Extruded heatsink", category: "Mechanical", type: "purchased", cost: "2.15", supplier: "CVM", lead: 14, moq: "150", wh: "MPL-STORES" },
  { sku: "GSK-SIL", name: "Silicone enclosure gasket", category: "Mechanical", type: "purchased", cost: "0.85", supplier: "DRP", lead: 10, moq: "300", wh: "MPL-STORES" },
  { sku: "ORING-V12", name: "Fluoroelastomer O-ring, 12 mm", category: "Mechanical", type: "purchased", cost: "0.22", supplier: "DRP", lead: 10, moq: "500", tracking: "lot", shelfLife: 150, wh: "MPL-STORES" },
  { sku: "KNOB-PC", name: "Polycarbonate control knob", category: "Mechanical", type: "purchased", cost: "0.55", supplier: "DRP", lead: 10, moq: "200", wh: "RST-MAIN" },
  { sku: "BEZEL-HMI", name: "HMI front bezel", category: "Mechanical", type: "purchased", cost: "3.20", supplier: "DRP", lead: 12, moq: "60", wh: "RST-MAIN" },
  { sku: "CLIP-DIN", name: "DIN-rail mounting clip", category: "Mechanical", type: "purchased", cost: "0.40", supplier: "DRP", lead: 10, moq: "200", wh: "RST-MAIN" },
  { sku: "SCR-M3", name: "Screw M3 × 8, stainless", category: "Fastener", type: "purchased", cost: "0.0350", supplier: "EVF", lead: 7, moq: "2000", wh: "MPL-STORES" },
  { sku: "SCR-M4", name: "Screw M4 × 12, stainless", category: "Fastener", type: "purchased", cost: "0.0600", supplier: "EVF", lead: 7, moq: "1000", wh: "RST-MAIN" },
  { sku: "FAN-80", name: "80 mm cooling fan, 24 V", category: "Electromechanical", type: "purchased", cost: "4.80", supplier: "IPS", lead: 18, moq: "40", wh: "RST-MAIN" },
  // Sensors
  { sku: "SNS-PIEZO", name: "Piezoresistive pressure die", category: "Sensor Element", type: "purchased", cost: "18.40", supplier: "GPS", lead: 28, moq: "60", tracking: "lot", shelfLife: 365, wh: "MPL-STORES" },
  { sku: "RTD-PT100", name: "PT100 RTD element, class A", category: "Sensor Element", type: "purchased", cost: "6.20", supplier: "GPS", lead: 21, moq: "100", tracking: "lot", wh: "MPL-STORES" },
  { sku: "PROBE-REF", name: "Reference temperature probe", category: "Sensor Element", type: "purchased", cost: "31.00", supplier: "GPS", lead: 21, moq: "20", tracking: "lot", wh: "MPL-STORES" },
  // Cable & power
  { sku: "CBL-M12-2M", name: "M12 cable assembly, 2 m", category: "Cable & Wire", type: "purchased", cost: "7.45", supplier: "HCW", lead: 12, moq: "100", wh: "MPL-STORES" },
  { sku: "WIRE-18", name: "Hookup wire, 18 AWG", category: "Cable & Wire", type: "purchased", uom: "m", cost: "0.38", supplier: "HCW", lead: 7, moq: "500", wh: "RST-MAIN" },
  { sku: "HARN-PMC", name: "Pump controller wiring harness", category: "Cable & Wire", type: "purchased", cost: "16.90", supplier: "HCW", lead: 15, moq: "30", wh: "RST-MAIN" },
  { sku: "PSU-DIN", name: "DIN-rail 24 V supply, 120 W", category: "Power", type: "purchased", cost: "27.50", supplier: "IPS", lead: 24, moq: "20", wh: "RST-MAIN" },
  { sku: "VFD-CORE", name: "Variable-frequency drive core, 2.2 kW", category: "Power", type: "purchased", cost: "212.00", supplier: "IPS", lead: 35, moq: "6", tracking: "lot", wh: "RST-MAIN" },
  // Packaging & consumables
  { sku: "BOX-S", name: "Shipping carton, small", category: "Packaging", type: "purchased", cost: "0.95", supplier: "FMP", lead: 6, moq: "500", wh: "MPL-STORES" },
  { sku: "BOX-L", name: "Shipping carton, large", category: "Packaging", type: "purchased", cost: "3.10", supplier: "FMP", lead: 6, moq: "100", wh: "RST-MAIN" },
  { sku: "FOAM-INS", name: "Foam insert", category: "Packaging", type: "purchased", cost: "0.70", supplier: "FMP", lead: 6, moq: "500", wh: "MPL-STORES" },
  { sku: "LBL-RATE", name: "Product rating label", category: "Packaging", type: "purchased", cost: "0.12", supplier: "FMP", lead: 6, moq: "2000", wh: "MPL-STORES" },
  { sku: "DOC-QSG", name: "Printed quick start guide", category: "Packaging", type: "purchased", cost: "0.45", supplier: "FMP", lead: 6, moq: "1000", wh: "MPL-STORES" },
  { sku: "CASE-CAL", name: "Calibration kit carry case", category: "Packaging", type: "purchased", cost: "19.50", supplier: "DRP", lead: 12, moq: "20", wh: "MPL-STORES" },
  { sku: "EPOXY-2K", name: "Two-part potting epoxy", category: "Consumable", type: "purchased", uom: "kg", cost: "24.00", supplier: "DRP", lead: 10, moq: "10", tracking: "lot", shelfLife: 120, wh: "MPL-STORES" },
];

/** [component sku, quantity per, scrap %] */
export const BOMS: Record<string, [string, string, string?][]> = {
  "SA-PCB100": [["PCB-100", "1"], ["IC-MCU32", "1"], ["IC-ADC24", "1"], ["CAP-100N", "24", "2"], ["CAP-10U", "6", "2"], ["RES-10K", "18", "2"], ["RES-1K", "12", "2"], ["CON-M12", "1"]],
  "SA-PCB200": [["PCB-200", "1"], ["IC-MCU32", "1"], ["IC-ADC24", "2"], ["IC-DRV-H", "2"], ["CAP-100N", "40", "2"], ["CAP-10U", "10", "2"], ["RES-10K", "30", "2"], ["RES-1K", "20", "2"]],
  "SA-PCB300": [["PCB-300", "1"], ["IC-MCU32", "1"], ["IC-DRV-H", "4"], ["CAP-100N", "36", "2"], ["CAP-10U", "12", "2"], ["RES-10K", "24", "2"], ["CON-TB8", "1"]],
  "SA-PSU24": [["XFMR-FLY", "1"], ["IC-PSUCTL", "1"], ["MOSFET-60V", "2"], ["CAP-10U", "8", "2"], ["RES-1K", "6", "2"], ["HEATSINK", "1"]],
  "SA-SNSHEAD": [["HSG-SNS", "1"], ["DIAPH-316", "1"], ["SNS-PIEZO", "1", "3"], ["ORING-V12", "2", "5"], ["EPOXY-2K", "0.05"]],
  "SA-HMI": [["LCD-43", "1"], ["BEZEL-HMI", "1"], ["KNOB-PC", "2"], ["SCR-M4", "4"]],
  "SA-PMCBASE": [["ENC-ALU-L", "1"], ["PSU-DIN", "1"], ["RLY-30A", "2"], ["HARN-PMC", "1"], ["FAN-80", "1"], ["SCR-M4", "8"], ["CLIP-DIN", "2"]],
  "FG-ECM100": [["SA-PCB100", "1"], ["SA-PSU24", "1"], ["ENC-ALU-S", "1"], ["GSK-SIL", "1"], ["SCR-M3", "4", "1"], ["LBL-RATE", "1"], ["BOX-S", "1"], ["FOAM-INS", "1"], ["DOC-QSG", "1"]],
  "FG-ECM200": [["SA-PCB200", "1"], ["SA-PSU24", "1"], ["ENC-ALU-S", "1"], ["GSK-SIL", "1"], ["SCR-M3", "6", "1"], ["LBL-RATE", "1"], ["BOX-S", "1"], ["FOAM-INS", "1"], ["DOC-QSG", "1"]],
  "FG-SNS310": [["SA-SNSHEAD", "1"], ["SA-PCB100", "1"], ["CBL-M12-2M", "1"], ["LBL-RATE", "1"], ["BOX-S", "1"]],
  "FG-SNS420": [["RTD-PT100", "1", "2"], ["THERMOWELL", "1"], ["SA-PCB100", "1"], ["CBL-M12-2M", "1"], ["LBL-RATE", "1"], ["BOX-S", "1"]],
  "FG-CALKIT": [["CASE-CAL", "1"], ["PROBE-REF", "1"]],
  "FG-PMC500": [["SA-PMCBASE", "1"], ["SA-PCB300", "1"], ["SA-HMI", "1"], ["CON-TB8", "2"], ["WIRE-18", "3", "5"], ["LBL-RATE", "1"], ["BOX-L", "1"], ["DOC-QSG", "1"]],
  "FG-PMC750": [["SA-PMCBASE", "1"], ["SA-PCB300", "1"], ["SA-HMI", "1"], ["VFD-CORE", "1"], ["CON-TB8", "3"], ["WIRE-18", "4", "5"], ["LBL-RATE", "1"], ["BOX-L", "1"], ["DOC-QSG", "1"]],
};

/** [work center, setup hours, run hours per unit, description] */
export const ROUTINGS: Record<string, [string, string, string, string][]> = {
  "SA-PCB100": [["SMT-1", "1.0", "0.02", "SMT placement & reflow"], ["TEST-M", "0.25", "0.01", "AOI and in-circuit test"]],
  "SA-PCB200": [["SMT-1", "1.0", "0.03", "SMT placement & reflow"], ["TEST-M", "0.25", "0.015", "AOI and in-circuit test"]],
  "SA-PCB300": [["SMT-2", "1.0", "0.035", "SMT placement & reflow"], ["TEST-R", "0.25", "0.02", "In-circuit test"]],
  "SA-PSU24": [["SMT-1", "0.5", "0.015", "SMT placement"], ["ASM-M", "0.25", "0.05", "Through-hole & heatsink"]],
  "SA-SNSHEAD": [["ASM-M", "0.5", "0.12", "Die attach & potting"], ["TEST-M", "0.25", "0.05", "Leak and span test"]],
  "SA-HMI": [["ASM-R", "0.25", "0.08", "Display & bezel assembly"]],
  "SA-PMCBASE": [["MCH-R", "1.0", "0.2", "Enclosure machining"], ["ASM-R", "0.5", "0.35", "Chassis wiring"]],
  "FG-ECM100": [["ASM-M", "0.5", "0.12", "Final assembly"], ["TEST-M", "0.25", "0.06", "End-of-line test"], ["PACK-M", "0.1", "0.02", "Label & pack"]],
  "FG-ECM200": [["ASM-M", "0.5", "0.15", "Final assembly"], ["TEST-M", "0.25", "0.08", "End-of-line test"], ["PACK-M", "0.1", "0.02", "Label & pack"]],
  "FG-SNS310": [["ASM-M", "0.5", "0.15", "Final assembly"], ["TEST-M", "0.5", "0.1", "Pressure calibration"], ["PACK-M", "0.1", "0.02", "Label & pack"]],
  "FG-SNS420": [["ASM-M", "0.5", "0.1", "Final assembly"], ["TEST-M", "0.25", "0.08", "Temperature calibration"], ["PACK-M", "0.1", "0.02", "Label & pack"]],
  "FG-CALKIT": [["PACK-M", "0.1", "0.05", "Kit and pack"]],
  "FG-PMC500": [["ASM-R", "1.0", "0.9", "Final assembly"], ["TEST-R", "0.5", "0.4", "Functional test"]],
  "FG-PMC750": [["ASM-R", "1.0", "1.2", "Final assembly"], ["TEST-R", "0.5", "0.5", "Functional & load test"]],
};

/** Average weekly demand (units) used to size stocking parameters and generate orders. */
export const WEEKLY_DEMAND: Record<string, number> = {
  "FG-ECM100": 34,
  "FG-ECM200": 14,
  "FG-SNS310": 16,
  "FG-SNS420": 18,
  "FG-CALKIT": 5,
  "FG-PMC500": 5,
  "FG-PMC750": 3,
};

/** Which warehouse each manufactured item draws components from and ships/stocks output to. */
export const PRODUCTION_SITE: Record<string, "MPL" | "RST"> = {
  "FG-ECM100": "MPL",
  "FG-ECM200": "MPL",
  "FG-SNS310": "MPL",
  "FG-SNS420": "MPL",
  "FG-CALKIT": "MPL",
  "SA-PCB100": "MPL",
  "SA-PCB200": "MPL",
  "SA-PSU24": "MPL",
  "SA-SNSHEAD": "MPL",
  "FG-PMC500": "RST",
  "FG-PMC750": "RST",
  "SA-PCB300": "RST",
  "SA-HMI": "RST",
  "SA-PMCBASE": "RST",
};
