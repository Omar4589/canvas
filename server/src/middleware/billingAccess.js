// WHO IS A BILLING ADMIN — one predicate, so the billing router's gate (routes/admin/billing.js) and
// the archive reminder's renewal dates (routes/admin/billingRenewals.js) can never disagree about it.
//
// Billing is restricted to the bill-payer admins (Membership.billingAccess), not every org admin;
// super admins always pass. Both callers sit behind requireOrgRole('admin'), which is what keeps
// out a lead whose billingAccess outlived a demotion (the flag isn't cleared when the role drops).
export const hasBillingAccess = (req) => Boolean(req.user?.isSuperAdmin || req.activeMembership?.billingAccess);

export const requireBillingAccess = (req, res, next) => {
  if (hasBillingAccess(req)) return next();
  return res.status(403).json({ error: 'Billing is restricted to billing admins.', code: 'billing-access-required' });
};
