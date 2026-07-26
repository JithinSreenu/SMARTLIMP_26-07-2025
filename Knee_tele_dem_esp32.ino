/* ==========================================================================
   KNEE-AI Telemetry Studio — ESP32 TEST sender
   Sends synthetic 25-byte frames matching index.html's PROTOCOL config,
   just to verify the Web Serial USB link + parser + charts before real
   STM32 firmware is wired up.

   Board: ESP32 Dev Module (or any ESP32/ESP32-S3/ESP32-C3 board)
   Baud:  115200  (pick 115200 in the dashboard's "Baud rate" dropdown)

   NOTE ON PORTS:
   - Boards with a USB-UART bridge (CP2102/CH340, e.g. classic ESP32 DevKit):
     just use Serial (USB0) as below — identical to the Uno version.
   - Boards with native USB (ESP32-S2/S3 in USB-CDC mode): Serial still
     works if "USB CDC On Boot" is enabled in Tools menu; otherwise use
     Serial0/USBSerial depending on core version.
   - If you instead want to feed this into an STM32 over a wired UART
     (not USB), use Serial2 on GPIO16(RX)/GPIO17(TX) instead — see the
     commented alternative in setup().
   ========================================================================== */

const uint8_t HEADER0 = 0xAA;
const uint8_t HEADER1 = 0x55;
const uint8_t FRAME_LEN = 25;

uint8_t frame[FRAME_LEN];
uint8_t seqCounter = 0;
unsigned long t0;

/* ---- CRC-16/MODBUS: poly 0xA001 (reflected), init 0xFFFF ----
   Must match crc16() 'CRC16' branch in index.html exactly. */
uint16_t crc16_modbus(const uint8_t *data, uint8_t start, uint8_t end) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = start; i < end; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else               crc = (crc >> 1);
    }
  }
  return crc;
}

/* little-endian int16 write */
void writeInt16LE(uint8_t *buf, uint8_t offset, int16_t v) {
  buf[offset]     = (uint8_t)(v & 0xFF);
  buf[offset + 1] = (uint8_t)((v >> 8) & 0xFF);
}
void writeUint16LE(uint8_t *buf, uint8_t offset, uint16_t v) {
  buf[offset]     = (uint8_t)(v & 0xFF);
  buf[offset + 1] = (uint8_t)((v >> 8) & 0xFF);
}

void setup() {
  Serial.begin(115200);

  // Alternative: wired UART instead of USB, e.g. to feed an STM32 directly.
  // Serial2.begin(115200, SERIAL_8N1, 16, 17);  // RX=GPIO16, TX=GPIO17

  t0 = millis();
}

void loop() {
  float t = (millis() - t0) / 1000.0;   // seconds since start
  float phase = fmod(t, 1.1) / 1.1;     // fake 1.1 s gait cycle

  /* fake engineering values, just enough to see numbers move */
  float force  = 100.0 + 600.0 * sin(phase * PI);          // N
  float moment = 20.0 * sin(phase * 2 * PI);                // Nm
  float knee   = 10.0 + 50.0 * (phase > 0.6 ? (phase - 0.6) / 0.4 : 0); // deg
  uint16_t valve = (uint16_t)(30 + 40 * phase);              // %
  float battery = 8.20 - (t * 0.0002);                       // V, slow decay
  uint8_t state = (phase < 0.04) ? 0 : (phase < 0.58) ? 1 : (phase < 0.92) ? 2 : 3;
  uint8_t fault = 0;

  /* ---- build frame ---- */
  frame[0] = HEADER0;
  frame[1] = HEADER1;
  frame[2] = seqCounter++;
  writeInt16LE(frame, 3,  (int16_t)(force  * 100));
  writeInt16LE(frame, 5,  (int16_t)(moment * 100));
  writeInt16LE(frame, 7,  (int16_t)(knee   * 100));
  writeUint16LE(frame, 9,  valve);
  writeUint16LE(frame, 11, (uint16_t)(battery * 100));
  frame[13] = state;
  frame[14] = fault;
  for (uint8_t i = 15; i <= 22; i++) frame[i] = 0x00;   // reserved, zero-fill

  uint16_t crc = crc16_modbus(frame, 0, 23);   // CRC over bytes 0..22
  frame[23] = (uint8_t)(crc & 0xFF);           // little-endian CRC
  frame[24] = (uint8_t)((crc >> 8) & 0xFF);

  Serial.write(frame, FRAME_LEN);

  delay(100);   // ~10 Hz — plenty to see charts move; also feeds the WDT
}
