const DAY = 86_400_000;
const HOUR = 3_600_000;

const CUSTOMERS = {
  'C-101': { id: 'C-101', name: 'Maya Chen', email: 'maya.chen@example.com', phone: '+1 415 555 0101' },
  'C-102': { id: 'C-102', name: 'Liam Patel', email: 'liam.patel@example.com', phone: '+1 512 555 0102' },
  'C-103': { id: 'C-103', name: 'Sofia Reyes', email: 'sofia.reyes@example.com', phone: '+1 305 555 0103' },
  'C-104': { id: 'C-104', name: 'Noah Kim', email: 'noah.kim@example.com', phone: '+1 206 555 0104' },
  'C-105': { id: 'C-105', name: 'Ava Thompson', email: 'ava.thompson@example.com', phone: '+1 617 555 0105' },
  'C-106': { id: 'C-106', name: 'Ethan Brooks', email: 'ethan.brooks@example.com', phone: '+1 720 555 0106' },
  'C-107': { id: 'C-107', name: 'Isla Garcia', email: 'isla.garcia@example.com', phone: '+1 305 555 0107' },
  'C-108': { id: 'C-108', name: 'Lucas Meyer', email: 'lucas.meyer@example.com', phone: '+1 503 555 0108' },
  'C-109': { id: 'C-109', name: 'Emma Silva', email: 'emma.silva@example.com', phone: '+1 212 555 0109' },
  'C-110': { id: 'C-110', name: 'Oliver Novak', email: 'oliver.novak@example.com', phone: '+1 312 555 0110' },
  'C-111': { id: 'C-111', name: 'Mia Rossi', email: 'mia.rossi@example.com', phone: '+1 646 555 0111' },
  'C-112': { id: 'C-112', name: 'Jack Wilson', email: 'jack.wilson@example.com', phone: '+1 801 555 0112' }
};

function item(sku, name, unitCents, qty = 1, variant = null) {
  return { sku, name, qty, unitCents, variant };
}

export function createSeed(now = new Date()) {
  const at = (days = 0, hours = 0) => new Date(now.getTime() + days * DAY + hours * HOUR).toISOString();

  const orders = [
    {
      id: '1001',
      customerId: 'C-101',
      customer: CUSTOMERS['C-101'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-9),
      deliveredAt: at(-4),
      address: { line1: '1840 Grand Ave', city: 'Oakland', state: 'CA', postalCode: '94612' },
      items: [
        item('NW-BP28', 'Trailhead 28L Backpack', 12_900, 1, 'Moss / 28L'),
        item('NW-SK-M', 'Merino Hiker Socks', 1_800, 1, 'Charcoal / M')
      ],
      totalCents: 14_700,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'UPS',
        tracking: '1Z999AA10123456784',
        service: 'UPS Ground',
        status: 'delivered',
        eta: at(-4),
        events: [
          { at: at(-8), label: 'Shipping label created', location: 'Oakland, CA' },
          { at: at(-7), label: 'Picked up by carrier', location: 'Oakland, CA' },
          { at: at(-6), label: 'Arrived at regional hub', location: 'Sacramento, CA' },
          { at: at(-5), label: 'Out for delivery', location: 'Oakland, CA' },
          { at: at(-4), label: 'Delivered — left at front door', location: 'Oakland, CA' }
        ]
      }
    },
    {
      id: '1002',
      customerId: 'C-102',
      customer: CUSTOMERS['C-102'],
      status: 'in_transit',
      channel: 'WhatsApp',
      placedAt: at(-4),
      deliveredAt: null,
      address: { line1: '411 W 4th St', city: 'Austin', state: 'TX', postalCode: '78701' },
      items: [item('NW-RS-L', 'Ridgeline Rain Shell', 9_800, 1, 'Slate / L')],
      totalCents: 9_800,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'UPS',
        tracking: '1Z999AA10198765432',
        service: 'UPS 2nd Day Air',
        status: 'in_transit',
        eta: at(2),
        events: [
          { at: at(-4), label: 'Shipping label created', location: 'Reno, NV' },
          { at: at(-3), label: 'Picked up by carrier', location: 'Reno, NV' },
          { at: at(-2), label: 'Arrived at sort facility', location: 'Sacramento, CA' },
          { at: at(-1), label: 'Departed sort facility', location: 'Phoenix, AZ' }
        ]
      }
    },
    {
      id: '1003',
      customerId: 'C-103',
      customer: CUSTOMERS['C-103'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-50),
      deliveredAt: at(-46),
      address: { line1: '900 Biscayne Blvd', city: 'Miami', state: 'FL', postalCode: '33132' },
      items: [item('NW-DJ-M', 'Summit Down Jacket', 24_000, 1, 'Navy / M')],
      totalCents: 24_000,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'FedEx',
        tracking: '782341905551',
        service: 'FedEx Home Delivery',
        status: 'delivered',
        eta: at(-46),
        events: [
          { at: at(-49), label: 'Shipping label created', location: 'Denver, CO' },
          { at: at(-48), label: 'Picked up by carrier', location: 'Denver, CO' },
          { at: at(-46), label: 'Delivered', location: 'Miami, FL' }
        ]
      }
    },
    {
      id: '1004',
      customerId: 'C-104',
      customer: CUSTOMERS['C-104'],
      status: 'out_for_delivery',
      channel: 'WhatsApp',
      placedAt: at(-2),
      deliveredAt: null,
      address: { line1: '1201 Pike St', city: 'Seattle', state: 'WA', postalCode: '98101' },
      items: [item('NW-SP-R', 'Basecamp Sleeping Pad', 8_900, 1, 'Regular')],
      totalCents: 8_900,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'FedEx',
        tracking: '782341905990',
        service: 'FedEx Ground',
        status: 'out_for_delivery',
        eta: at(0),
        events: [
          { at: at(-2), label: 'Shipping label created', location: 'Portland, OR' },
          { at: at(-2), label: 'Picked up by carrier', location: 'Portland, OR' },
          { at: at(-1), label: 'Arrived at local facility', location: 'Seattle, WA' },
          { at: at(0, -3), label: 'On vehicle for delivery', location: 'Seattle, WA' }
        ]
      }
    },
    {
      id: '1005',
      customerId: 'C-105',
      customer: CUSTOMERS['C-105'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-11),
      deliveredAt: at(-8),
      address: { line1: '77 Massachusetts Ave', city: 'Cambridge', state: 'MA', postalCode: '02139' },
      items: [item('NW-BT-750', 'Insulated Bottle 750ml', 3_499, 1, 'Sand')],
      totalCents: 3_499,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'USPS',
        tracking: '9400111899223197421111',
        service: 'USPS Ground Advantage',
        status: 'delivered',
        eta: at(-8),
        events: [
          { at: at(-10), label: 'Shipping label created', location: 'Newark, NJ' },
          { at: at(-9), label: 'Accepted at USPS origin facility', location: 'Newark, NJ' },
          { at: at(-8), label: 'Delivered, front porch', location: 'Cambridge, MA' }
        ]
      }
    },
    {
      id: '1006',
      customerId: 'C-106',
      customer: CUSTOMERS['C-106'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-6),
      deliveredAt: at(-2),
      address: { line1: '1600 Broadway', city: 'Denver', state: 'CO', postalCode: '80202' },
      items: [
        item('NW-TP', 'Alpine Trekking Poles', 7_400, 1),
        item('NW-TENT-2P', 'Ultralight 2P Tent', 13_600, 1, 'Alpine Green')
      ],
      totalCents: 21_000,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'UPS',
        tracking: '1Z999AA10155551212',
        service: 'UPS Ground',
        status: 'delivered',
        eta: at(-2),
        events: [
          { at: at(-5), label: 'Shipping label created', location: 'Salt Lake City, UT' },
          { at: at(-4), label: 'Picked up by carrier', location: 'Salt Lake City, UT' },
          { at: at(-2), label: 'Delivered', location: 'Denver, CO' }
        ]
      }
    },
    {
      id: '1007',
      customerId: 'C-107',
      customer: CUSTOMERS['C-107'],
      status: 'in_transit',
      channel: 'WhatsApp',
      placedAt: at(-16),
      deliveredAt: null,
      address: { line1: '245 Ocean Dr', city: 'Miami Beach', state: 'FL', postalCode: '33139' },
      items: [item('NW-CS', 'Pocket Camp Stove', 5_800, 1)],
      totalCents: 5_800,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'USPS',
        tracking: '9400111899223197428490',
        service: 'USPS Priority Mail',
        status: 'in_transit',
        eta: at(-3),
        events: [
          { at: at(-16), label: 'Shipping label created', location: 'Columbus, OH' },
          { at: at(-15), label: 'Accepted at USPS origin facility', location: 'Columbus, OH' },
          { at: at(-12), label: 'Arrived at USPS regional origin facility', location: 'Columbus, OH' }
        ]
      }
    },
    {
      id: '1008',
      customerId: 'C-108',
      customer: CUSTOMERS['C-108'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-15),
      deliveredAt: at(-12),
      address: { line1: '815 SE Alder St', city: 'Portland', state: 'OR', postalCode: '97214' },
      items: [item('NW-HL', 'TrailBeam Headlamp', 4_500, 1)],
      totalCents: 4_500,
      refundedTotalCents: 4_500,
      shipment: {
        carrier: 'UPS',
        tracking: '1Z999AA10133334444',
        service: 'UPS Ground',
        status: 'delivered',
        eta: at(-12),
        events: [
          { at: at(-14), label: 'Shipping label created', location: 'Boise, ID' },
          { at: at(-13), label: 'Picked up by carrier', location: 'Boise, ID' },
          { at: at(-12), label: 'Delivered', location: 'Portland, OR' }
        ]
      }
    },
    {
      id: '1009',
      customerId: 'C-109',
      customer: CUSTOMERS['C-109'],
      status: 'processing',
      channel: 'WhatsApp',
      placedAt: at(-1),
      deliveredAt: null,
      address: { line1: '350 5th Ave', city: 'New York', state: 'NY', postalCode: '10118' },
      items: [
        item('NW-SK-L', 'Merino Hiker Socks', 1_800, 1, 'Charcoal / L'),
        item('NW-DB-10', '10L Dry Bag', 2_200, 1, 'Yellow')
      ],
      totalCents: 4_000,
      refundedTotalCents: 0,
      shipment: null
    },
    {
      id: '1010',
      customerId: 'C-110',
      customer: CUSTOMERS['C-110'],
      status: 'delivered',
      channel: 'WhatsApp',
      placedAt: at(-26),
      deliveredAt: at(-22),
      address: { line1: '233 S Wacker Dr', city: 'Chicago', state: 'IL', postalCode: '60606' },
      items: [item('NW-TS-10', 'Ridge Runner Trail Shoes', 15_000, 1, 'Grey / 10')],
      totalCents: 15_000,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'FedEx',
        tracking: '782341906112',
        service: 'FedEx Ground',
        status: 'delivered',
        eta: at(-22),
        events: [
          { at: at(-25), label: 'Shipping label created', location: 'Memphis, TN' },
          { at: at(-23), label: 'In transit', location: 'Indianapolis, IN' },
          { at: at(-22), label: 'Delivered', location: 'Chicago, IL' }
        ]
      }
    },
    {
      id: '1011',
      customerId: 'C-111',
      customer: CUSTOMERS['C-111'],
      status: 'returned',
      channel: 'WhatsApp',
      placedAt: at(-23),
      deliveredAt: at(-20),
      address: { line1: '55 Water St', city: 'New York', state: 'NY', postalCode: '10041' },
      items: [item('NW-CH', 'Basecamp Chair', 7_500, 1, 'Rust')],
      totalCents: 7_500,
      refundedTotalCents: 0,
      shipment: {
        carrier: 'UPS',
        tracking: '1Z999AA10177778888',
        service: 'UPS Ground',
        status: 'delivered',
        eta: at(-20),
        events: [
          { at: at(-22), label: 'Shipping label created', location: 'Charlotte, NC' },
          { at: at(-21), label: 'Picked up by carrier', location: 'Charlotte, NC' },
          { at: at(-20), label: 'Delivered', location: 'New York, NY' }
        ]
      }
    },
    {
      id: '1012',
      customerId: 'C-112',
      customer: CUSTOMERS['C-112'],
      status: 'cancelled',
      channel: 'WhatsApp',
      placedAt: at(-6),
      deliveredAt: null,
      cancelledAt: at(-5),
      address: { line1: '3500 S State St', city: 'Salt Lake City', state: 'UT', postalCode: '84115' },
      items: [item('NW-MUG', 'Enamel Camp Mug', 2_900, 1, 'Cream')],
      totalCents: 2_900,
      refundedTotalCents: 0,
      shipment: null
    }
  ];

  const returns = [
    {
      id: 'RMA-2B7QX',
      orderId: '1011',
      customerId: 'C-111',
      reason: 'Size too large',
      status: 'received',
      createdAt: at(-13),
      updatedAt: at(-9),
      refundEstimateCents: 7_500,
      dropoffBy: at(-6)
    }
  ];

  const refunds = [
    {
      id: 'RF-7K2M9',
      orderId: '1008',
      customerId: 'C-108',
      amountCents: 4_500,
      mode: 'auto',
      status: 'succeeded',
      reason: 'Package arrived damaged',
      createdAt: at(-10)
    }
  ];

  return {
    version: 1,
    storeName: 'Northwind Supply Co.',
    createdAt: now.toISOString(),
    orders,
    returns,
    refunds,
    escalations: []
  };
}
