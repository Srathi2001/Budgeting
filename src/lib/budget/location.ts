// Community of a property, for rent comparisons by location. Set in Admin → Properties; when it is
// blank, it is recognised from the property name.

const BY_NAME: [RegExp, string][] = [
  [/HOR AL ANZ/, 'Hor Al Anz'],
  [/AIRPORT ROAD/, 'Airport Road'],
  [/MUTEENA/, 'Al Muteena'],
  [/QUSAIS/, 'Al Qusais'],
  [/RUWAIYA|WARSAN/, 'Al Warsan'],
  [/SONAPUR/, 'Sonapur'],
  [/FUJAIRAH/, 'Fujairah'],
  [/GARHOUD/, 'Al Garhoud'],
  [/JUMEIRAH/, 'Jumeirah'],
  [/KARAMA|KIFAF/, 'Karama'],
  [/MIRDIFF|MIRDIF/, 'Mirdif'],
  [/MUHAISINAH|MUHAISNAH/, 'Muhaisnah'],
  [/UMM SEQUEIM|UMM SUQEIM/, 'Umm Suqeim'],
  [/SHAIK ZAYED|SHEIKH ZAYED|SZR/, 'Sheikh Zayed Road'],
  [/BARAHA/, 'Al Baraha'],
  [/AL RAFA/, 'Al Rafa'],
  [/FRIJ MURAR/, 'Frij Murar'],
  [/INTERNATIONAL CITY/, 'International City'],
  [/WARQAA/, 'Al Warqaa'],
  [/KHAWANEEJ|KHAWNEEJ/, 'Al Khawaneej'],
  [/SABKHA/, 'Al Sabkha'],
  [/TWAR/, 'Al Twar'],
  [/NAIF/, 'Naif'],
  [/\bDIP\b|INVESTMENT PARK/, 'Dubai Investments Park'],
];

export function locationOf(p: { name: string; location: string | null }): string {
  if (p.location?.trim()) return p.location.trim();
  const n = p.name.toUpperCase();
  return BY_NAME.find(([re]) => re.test(n))?.[1] ?? 'Not set';
}
