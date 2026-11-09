// Original, layered snowy-owl post illustration. Animation belongs to the controller/CSS.
// All IDs are namespaced so multiple previews and app instances can coexist.
export function letterArt(idPrefix = 'owl-letter') {
  const id = String(idPrefix).replace(/[^a-zA-Z0-9_-]/g, '-');
  const wing = `
    <path d="M215 224C186 217 160 192 136 166C108 136 69 120 34 98C41 123 63 148 97 169L77 158C91 181 114 201 143 215L108 202C126 227 155 243 182 247L147 242C166 258 196 268 216 255C230 246 232 233 215 224Z" fill="url(#${id}-feather)" stroke="#AAA99D" stroke-width="1.7"/>
    <path d="M211 227C173 209 151 185 127 164C100 142 71 123 45 112C63 141 95 166 128 184" fill="none" stroke="#C3C2B8" stroke-width="1.8"/>
    <path d="M211 231C173 218 148 201 123 181M210 238C181 231 157 220 137 207M208 245C188 243 174 239 160 232" fill="none" stroke="#BCBDB2" stroke-width="1.6"/>
    <path d="M203 217C189 198 171 183 154 175C159 193 173 208 185 218M181 203C164 182 145 166 128 160C137 181 151 197 165 207" fill="#F9F9EF" stroke="#C5C5BA" stroke-width="1.3"/>
    <path d="M206 232C196 224 185 221 176 221C183 231 194 237 205 238" fill="#F0F2E8" stroke="#C9CABE" stroke-width="1.2"/>
  `;
  return `<svg class="owl-letter-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 380" aria-hidden="true" focusable="false" fill="none">
    <defs>
      <linearGradient id="${id}-feather" x1="200" y1="220" x2="80" y2="110" gradientUnits="userSpaceOnUse"><stop stop-color="#DFE4DA"/><stop offset=".47" stop-color="#F5F7EF"/><stop offset="1" stop-color="#FFFFF8"/></linearGradient>
      <linearGradient id="${id}-owl" x1="236" y1="95" x2="280" y2="258" gradientUnits="userSpaceOnUse"><stop stop-color="#FFFFFA"/><stop offset=".6" stop-color="#F3F4EB"/><stop offset="1" stop-color="#DFE4D9"/></linearGradient>
      <radialGradient id="${id}-iris"><stop stop-color="#E2B858"/><stop offset=".72" stop-color="#B88732"/><stop offset="1" stop-color="#8F672A"/></radialGradient>
      <linearGradient id="${id}-paper" x1="175" y1="207" x2="345" y2="348" gradientUnits="userSpaceOnUse"><stop stop-color="#F4E7C7"/><stop offset=".55" stop-color="#EBD9B3"/><stop offset="1" stop-color="#DCC49A"/></linearGradient>
      <linearGradient id="${id}-flap" x1="260" y1="209" x2="260" y2="288" gradientUnits="userSpaceOnUse"><stop stop-color="#FAEED2"/><stop offset="1" stop-color="#E8D3AA"/></linearGradient>
      <radialGradient id="${id}-wax" cx=".36" cy=".25" r=".8"><stop stop-color="#B94D45"/><stop offset=".45" stop-color="#92352F"/><stop offset="1" stop-color="#63221F"/></radialGradient>
      <filter id="${id}-mail-shadow" x="-25%" y="-25%" width="150%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#5E4029" flood-opacity=".14"/></filter>
    </defs>
    <g class="owl-carrier" stroke-linecap="round" stroke-linejoin="round">
      <g class="owl-wings">
        <g class="owl-wing-left">${wing}</g>
        <g class="owl-wing-right"><g transform="translate(520 0) scale(-1 1)">${wing}</g></g>
      </g>
      <g class="owl-body">
        <path d="M225 177C214 192 209 222 216 250C220 268 239 279 260 279C283 279 302 266 306 247C311 219 305 192 292 177Z" fill="url(#${id}-owl)" stroke="#ADAEA2" stroke-width="1.6"/>
        <path d="M232 197C239 210 247 216 260 216C273 216 281 209 289 197" stroke="#D7D9CD" stroke-width="1.3"/>
        <path d="M238 222L241 226L244 222M256 226L260 230L264 226M278 222L281 226L284 222M244 241L247 244L250 241M270 241L273 244L276 241" stroke="#A9AEA1" stroke-width="1.6"/>
      </g>
      <g class="owl-head">
        <path d="M204 145C202 120 213 100 232 93L242 96L253 87L263 94L275 90L285 98C306 106 318 123 316 146C323 178 303 202 261 204C220 204 200 181 204 145Z" fill="url(#${id}-owl)" stroke="#A3A79A" stroke-width="1.8"/>
        <path d="M212 143C213 121 228 109 245 113C254 114 260 120 260 125C267 114 284 109 296 119C309 131 311 148 305 168C297 188 281 196 260 196C235 196 216 186 212 165Z" fill="#FFFDF4"/>
        <path d="M225 124C231 119 239 118 245 121M275 121C283 117 291 121 296 125" stroke="#C3C6B8" stroke-width="2"/>
        <ellipse cx="238" cy="149" rx="23" ry="25" fill="#E5E6D9" stroke="#A7AA99" stroke-width="1.3"/>
        <ellipse cx="282" cy="149" rx="23" ry="25" fill="#E5E6D9" stroke="#A7AA99" stroke-width="1.3"/>
        <ellipse cx="238" cy="149" rx="18.8" ry="21" fill="url(#${id}-iris)"/>
        <ellipse cx="282" cy="149" rx="18.8" ry="21" fill="url(#${id}-iris)"/>
        <ellipse cx="238.8" cy="147.8" rx="13.4" ry="17" fill="#292726"/>
        <ellipse cx="281.2" cy="147.8" rx="13.4" ry="17" fill="#292726"/>
        <ellipse cx="233.3" cy="140.5" rx="5.2" ry="6.6" fill="#FFFFF9"/>
        <ellipse cx="275.8" cy="140.5" rx="5.2" ry="6.6" fill="#FFFFF9"/>
        <circle cx="245" cy="157" r="2.2" fill="#EAE6D6"/><circle cx="288" cy="157" r="2.2" fill="#EAE6D6"/>
        <path d="M253 173L260 167L267 173L260 183Z" fill="#46453D"/>
        <path d="M257 172L260 170L263 172" stroke="#717166" stroke-width="1.2"/>
        <path d="M246 105L249 108M260 102L260 106M271 105L269 109M216 172L219 174M304 172L301 174" stroke="#989E90" stroke-width="1.7"/>
      </g>
      <g class="owl-feet" fill="#ECEDE0" stroke="#A9AD9D" stroke-width="1.5">
        <path d="M222 204C218 200 214 203 215 209L217 218C214 211 210 212 210 216C210 221 215 227 220 225C224 229 229 224 229 218C233 215 230 210 226 213L226 207C226 204 224 203 222 204Z"/>
        <path d="M298 204C302 200 306 203 305 209L303 218C306 211 310 212 310 216C310 221 305 227 300 225C296 229 291 224 291 218C287 215 290 210 294 213L294 207C294 204 296 203 298 204Z"/>
      </g>
    </g>
    <g class="mail-envelope" stroke-linejoin="round" filter="url(#${id}-mail-shadow)">
      <g class="mail-back"><rect x="155" y="210" width="210" height="140" rx="5" fill="url(#${id}-paper)" stroke="#AA8C61" stroke-width="1.5"/>
        <path d="M156 212L260 282L364 212" fill="#D6BE95" stroke="#B99A70" stroke-width="1.1"/>
      </g>
      <g class="mail-paper"><rect x="170" y="224" width="180" height="111" rx="3" fill="#FFF7E5" stroke="#C6B18A" stroke-width="1"/>
        <path d="M192 247H328M192 260H320M192 273H326M192 286H305" stroke="#C8B898" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M252 304C247 297 239 301 243 307L252 314L261 307C265 301 257 297 252 304Z" fill="#C28A76"/>
      </g>
      <g class="mail-front">
        <path d="M155 215L258 280L155 345Z" fill="#ECDBBA" stroke="#B99C75" stroke-width="1.1"/>
        <path d="M365 215L262 280L365 345Z" fill="#E2CCA5" stroke="#B99C75" stroke-width="1.1"/>
        <path d="M156 347L260 269L364 347Q364 350 360 350H160Q156 350 156 347Z" fill="url(#${id}-paper)" stroke="#B2956B" stroke-width="1.1"/>
        <path d="M167 339L232 289M353 339L288 289" stroke="#F8EED8" stroke-width="1" opacity=".55"/>
      </g>
      <g class="mail-flap"><path d="M156 212L252 282Q260 288 268 282L364 212Z" fill="url(#${id}-flap)" stroke="#B69A70" stroke-width="1.3"/>
        <path d="M161 214L255 279Q260 282 265 279L359 214" stroke="#FFF7E7" stroke-width="1" opacity=".62"/>
      </g>
      <g class="mail-seal">
        <path d="M260 257C266 254 270 260 275 260C280 261 278 268 282 272C285 277 278 281 278 287C276 292 269 289 265 294C260 297 256 290 250 292C244 292 245 285 240 281C237 276 243 272 242 267C243 260 250 264 253 259C255 257 258 258 260 257Z" fill="url(#${id}-wax)" stroke="#74312B" stroke-width="1.1"/>
        <circle cx="260" cy="276" r="14.2" stroke="#CD7D61" stroke-width="1" opacity=".65"/>
        <path d="M252 268V284M268 268V284M252 276H268M249 268H255M265 268H271M249 284H255M265 284H271" stroke="#E0B489" stroke-width="1.65" stroke-linecap="round"/>
        <path d="M249 263C253 260 260 260 264 262" stroke="#F0B5A0" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>
      </g>
    </g>
  </svg>`;
}
