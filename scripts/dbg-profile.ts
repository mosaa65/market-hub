import { getCachedCompanyProfile, cacheCompanyProfile } from "../src/lib/printing/company-profile";
cacheCompanyProfile({
  name: "شركة النور للتجارة",
  name_ar: "شركة النور",
  phone: "771111",
  address: "صنعاء - شارع تعز",
});
const p = getCachedCompanyProfile();
console.log(JSON.stringify(p, null, 2));
