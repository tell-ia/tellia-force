Problem
Water for irrigation is getting scarcer. In dry summers, farmers face watering limits just when their crops need the most water. Deciding which field to water, when, and how much takes time and expertise. The data they need (weather, crop stage, soil, past watering) sits in different places.

Direction
We build an irrigation advisor that farmers use from the field, with a phone call or messages. Every morning it tells them which field to water, when, how many millimetres, and why. Farmers report their watering by voice, so the farm records stay up to date without typing. The advice comes from a transparent water balance based on the FAO-56 standard method:
- daily crop water need, from real weather, crop stage and soil;
- minus rain and past irrigation.

The AI only runs the conversation. All the numbers come from the calculation. The method works in every EU region, because the weather data covers all 1,151 regions.

Obstacles
- Data gaps: the hackathon data has real weather and soil data, but no forecast, no dated irrigation events, and only regional values, not values per field. We add the Open-Meteo forecast, the FAO-56 crop tables, and the farmer's own voice records.
- No proof of yield gain: the synthetic yields do not react to water. So we show the water saved and the pumping saved, and present yield effects as theoretical.
- Speed: during a call, answers must come in under 2 seconds. Heavy calculations run before the call, and the details go out on messages.
- Trust: each piece of advice explains its reason in one sentence, so the farmer can check it. (edited)


Plan :

UI - Capacitor (Mobile first) screen Marceau -> https://claude.ai/artifact/JqHig7fW4aCHbECbKphDo5?sk=z4hMwxaBk2R65LdKim7pRw#page-dcb81aee8d83
Screen UI
Chat UI
Changer les config des scenarios des data (Update des Dates)

Data :
Data Meteo à récupérer d'une vrai source
Degree day
Precipitation


Backend Deno:
Chat (Full Mastra)
Tool:
Get Weather
End point conseil: Conseil d'irrigation !!
resolve_parcel(query)
get_parcel_report(parcel_id)
simulate_scenario(parcel_id, events[], date)


Connect to VAPI 
Create a new vapi account
Twilio Phoner number
Vapi Assistant
Connect to Tools

SMS ?
Whatsapp ?

PS: Tester les Edge Case : Faire un UI de generation de Edge case + Déplacer la timeline

Secheresse
Innodation
Froids (gel)
Grele