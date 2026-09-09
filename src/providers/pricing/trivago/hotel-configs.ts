import "server-only";

export interface TrivagoHotelConfig {
  hotelSlug: string;
  hotelName: string;
  propertyId: string;
  searchPathSlug: string;
}

export const trivagoHotelConfigs = [
  {
    hotelSlug: "hotel-curi-executive",
    hotelName: "Hotel Curi Executive",
    propertyId: "2436946",
    searchPathSlug: "hotel-curi-executive-pelotas",
  },
  {
    hotelSlug: "curi-palace-hotel",
    hotelName: "Curi Palace Hotel",
    propertyId: "1180090",
    searchPathSlug: "curi-palace-hotel",
  },
  {
    hotelSlug: "hotel-alles-blau",
    hotelName: "Hotel Alles Blau",
    propertyId: "7770070",
    searchPathSlug: "hotel-alles-blau",
  },
  {
    hotelSlug: "jacques-georges-tower",
    hotelName: "Jacques Georges Tower",
    propertyId: "3387958",
    searchPathSlug: "jacques-georges-tower",
  },
  {
    hotelSlug: "jacques-georges-business",
    hotelName: "Hotel Jacques Georges Business",
    propertyId: "3487706",
    searchPathSlug: "jacques-georges-business",
  },
  {
    hotelSlug: "ibis-pelotas",
    hotelName: "ibis Pelotas",
    propertyId: "48115946",
    searchPathSlug: "ibis-pelotas",
  },
  {
    hotelSlug: "m-tower-hotel",
    hotelName: "M Tower Hotel",
    propertyId: "2899803",
    searchPathSlug: "m-tower-hotel",
  },
] as const satisfies readonly TrivagoHotelConfig[];
