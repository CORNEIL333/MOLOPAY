import type { Dictionary } from './fr';

/** NF-UX-002 : textes du portail partenaire, anglais. */
export const en: Dictionary = {
  common: { serviceDown: 'The service is not responding. Please try again.', loadFailed: 'Unable to load', actionFailed: 'Action failed', none: '—' },
  login: {
    title: 'MoloPay partner portal', login: 'Username', submit: 'Sign in with my security key',
    invalidLogin: 'Invalid username (lowercase letters, digits, dot, hyphen).',
    failedTitle: 'Sign-in failed', failedDetail: 'The security key did not confirm the sign-in. Please try again.',
  },
  enrollment: {
    title: 'Enrol my security key', login: 'Username', code: 'Enrolment code', submit: 'Register my security key',
    done: 'Key registered. You can now sign in.',
    invalidLogin: 'Invalid username (lowercase letters, digits, dot, hyphen).',
    invalidCode: 'Invalid enrolment code: copy the code you were given, as a single block.',
    failedTitle: 'Enrolment failed', failedDetail: 'The security key was not created. Try again or ask for a new code.',
  },
  counter: {
    title: 'Counter handover', code: 'Customer handover code', submit: 'Confirm the handover',
    invalidCode: 'The handover code has 10 characters (letters and digits).',
    noPositionTitle: 'Location unavailable', noPositionDetail: 'Allow location access for the counter: the handover must be geolocated.',
    failedTitle: 'Handover not confirmed', failedDetail: 'The service is not responding. Do not hand over the item; try again.',
    doneLead: (order: string): string => `Handover confirmed for order ${order} at `,
    doneTail: '. You may hand over the item.',
  },
  orders: {
    title: 'Orders', table: 'Orders', export: 'Export orders (CSV)',
    emptyTitle: 'No orders yet.', emptyDescription: 'Your customers’ orders will appear here after their first payment.',
    columns: { offer: 'Offer', status: 'Status', amount: 'Amount', progress: 'Progress', handover: 'Handover' },
    status: {
      ACTIVE: 'Saving in progress', FUNDED: 'Fully funded', HANDED_OVER: 'Handed over', PAID_TO_BENEFICIARY: 'Paid to beneficiary',
      CANCELLED_BY_CUSTOMER: 'Cancelled by customer', DISPUTED: 'Disputed', FROZEN: 'Frozen', REFUNDED: 'Refunded', CLOSED: 'Closed',
    },
  },
  payouts: {
    title: 'Settlements', table: 'Settlements',
    emptyTitle: 'No settlements yet.', emptyDescription: 'Settlements appear after each confirmed handover.',
    columns: { order: 'Order', gross: 'Gross', commission: 'Commission', net: 'Net', status: 'Status', reference: 'Reference' },
    status: { PREPARED: 'Prepared', APPROVED: 'Approved', REJECTED: 'Rejected', INSTRUCTED: 'Instruction sent', EXECUTED: 'Paid', EXECUTION_REJECTED: 'Payment rejected' },
  },
  offers: {
    title: 'Offers', table: 'Offers', notice: 'Offer changes go through the MoloPay team.',
    emptyTitle: 'No offers.', emptyDescription: 'Your offers will appear here once the MoloPay team creates them.',
    columns: { offer: 'Offer', price: 'Price', stock: 'Available stock', catalog: 'Catalogue' },
    untitled: 'Untitled', untitledDraft: 'Untitled (draft)', preorder: 'Pre-order', visible: 'Visible in catalogue', hidden: 'Not visible',
  },
  sellers: {
    title: 'Staff', table: 'Staff', columns: { login: 'Username', role: 'Role', state: 'Status', actions: 'Actions' },
    manager: 'Manager', seller: 'Seller', active: 'Active', disabled: 'Disabled',
    enrollmentButton: 'Enrolment code', enrollmentLabel: (login: string): string => `Issue an enrolment code for ${login}`,
    disableButton: 'Disable', disableLabel: (login: string): string => `Disable ${login}`,
    codeIntro: (login: string): string => `Enrolment code for ${login}, valid for 5 minutes, to be handed over in person. It will not be shown again.`,
    codeLabel: 'Enrolment code to hand over in person', codeHanded: 'I have handed over the code',
    disableTitle: (login: string): string => `Disable ${login}`, reason: 'Reason for disabling', reasonRequired: 'A reason is required.', confirmDisable: 'Confirm disabling',
    newTitle: 'New seller', newLogin: 'New seller username', create: 'Create the seller',
    invalidLogin: 'Invalid username (lowercase letters, digits, dot, hyphen; at least 3 characters).',
  },
  nav: {
    label: 'Partner portal', counter: 'Counter', orders: 'Orders', offers: 'Offers', payouts: 'Settlements', sellers: 'Sellers',
    signOut: 'Sign out', language: 'Français',
  },
};
