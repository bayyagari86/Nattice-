# Nattice Load Testing Guide

## Quick Start

### 1. Start Local Server
```bash
cd /Users/binoyayyagari/Downloads/trump-call-final
python3 -m http.server 3000
```

### 2. Host a Game
1. Open `http://localhost:3000` in your main browser
2. Click "Host Game"
3. Enter your name
4. Copy the **Room Code** and **Host ID** from the lobby

### 3. Run Load Test
1. Open `http://localhost:3000/load-test.html` in another tab
2. Paste the Host ID and Room Code
3. Set number of users (1-100)
4. Set delay between joins (500ms recommended)
5. Click "Start Load Test"

### 4. Monitor Results
- Watch the console logs in both windows
- Check the stats dashboard:
  - Total Users
  - Connected (successfully seated)
  - Failed (connection errors)
  - Average Join Time

## Debugging "Stuck on Joining" Issue

### Check Browser Console
**Host Browser:**
```
[Host] Join request from: TestUser1 peerId: TC_TEST_...
[Host] Assigning seat 1 to TestUser1
[Host] Sending SEAT_ASSIGNED to TC_TEST_... seat: 1
```

**Client Browser:**
```
[Client] Received SEAT_ASSIGNED, seat: 1
[Client] Updating lobby UI, mySeat: 1
```

### Common Issues

1. **SEAT_ASSIGNED not received**
   - Check if encryption key matches (room code must be exact)
   - Verify PeerJS connection is open
   - Check for network/firewall blocking WebRTC

2. **Connection timeout**
   - Host may be behind strict NAT/firewall
   - Try different network or use mobile hotspot
   - Check STUN server connectivity

3. **Game full (6 players max)**
   - Only 6 players can join
   - Refresh host to restart

## Multi-Browser Testing

### Test Across Browsers
1. **Chrome** - Host game
2. **Safari** - Join as Player 2
3. **Firefox** - Join as Player 3
4. **Chrome Incognito** - Join as Player 4
5. **Safari Private** - Join as Player 5
6. **Load Test Tool** - Join as Player 6

### Test Across Devices
1. **Desktop** - Host
2. **Mobile 1** - Scan QR code
3. **Mobile 2** - Manual join
4. **Tablet** - Join via URL
5. **Another Desktop** - Join manually

## Performance Benchmarks

### Expected Results
- **Join time**: < 2 seconds per user
- **Connection success rate**: > 95%
- **Card play sync**: < 100ms
- **State updates**: < 50ms

### Stress Test Scenarios
1. **5 users joining simultaneously** (0ms delay)
2. **10 users joining rapidly** (100ms delay)
3. **All 6 slots filled** (should reject 7th)
4. **Host disconnect/reconnect**
5. **Client disconnect during game**

## Troubleshooting

### Player Stuck on "Joining room..."
1. Open browser console (F12)
2. Look for errors or missing SEAT_ASSIGNED
3. Check if JOIN_REQUEST was sent
4. Verify host received the request
5. Check encryption/decryption errors

### Cards Not Clearing
1. Check console for CARD_PLAYED broadcasts
2. Verify all clients receive the message
3. Check if card ID matches
4. Ensure hand array is being updated

### Game Freeze After Card Play
1. Check if STATE_UPDATE is being sent
2. Verify broadcastState() is called
3. Check for JavaScript errors
4. Monitor network tab for failed messages

## Load Test Metrics

### What to Monitor
- **Connection Time**: Time from peer.connect() to SEAT_ASSIGNED
- **Success Rate**: Connected / Total attempts
- **Error Types**: Timeout, encryption, full game, etc.
- **Memory Usage**: Check browser task manager
- **Network Traffic**: Monitor WebRTC data channels

### Interpreting Results
- **100% success, <2s avg**: Excellent
- **>90% success, <5s avg**: Good
- **<90% success**: Network/NAT issues
- **>10s avg**: Performance problems

## Advanced Testing

### Simulate Network Conditions
1. Open Chrome DevTools
2. Go to Network tab
3. Select throttling (Fast 3G, Slow 3G)
4. Test join and gameplay

### Test Encryption
1. Join with wrong room code
2. Should fail to decrypt messages
3. Should not be seated

### Test Reconnection
1. Join successfully
2. Disable network briefly
3. Re-enable network
4. Check if reconnection works
