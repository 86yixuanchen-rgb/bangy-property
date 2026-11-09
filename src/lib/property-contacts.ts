export function propertyContacts(p: {
  managerName: string;
  managerEmail: string;
  ownerName: string;
  ownerEmail: string;
  tenantName: string;
  tenantEmail: string;
}) {
  return [
    { role: "Property Manager" as const, name: p.managerName, email: p.managerEmail },
    { role: "Landlord" as const, name: p.ownerName, email: p.ownerEmail },
    { role: "Tenant" as const, name: p.tenantName, email: p.tenantEmail },
  ].filter((p) => p.email);
}
