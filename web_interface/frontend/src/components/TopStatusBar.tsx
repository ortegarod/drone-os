import React from 'react';
import { DroneStatus } from '../types/drone';
import styles from './TopStatusBar.module.css';

interface TopStatusBarProps {
  droneStatus: DroneStatus;
}

const TopStatusBar: React.FC<TopStatusBarProps> = ({ droneStatus }) => {
  return (
    <div className={styles.statusBar}>
      <div className={styles.statusRow}>
        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Last Update:</span>
          <span className={styles.statusValue}>
            {droneStatus.timestamp ? new Date(droneStatus.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'NEVER'}
          </span>
        </div>

        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Connection:</span>
          <span className={`${styles.statusValue} ${droneStatus.connected ? styles.statusConnected : styles.statusDisconnected}`}>
            {droneStatus.connected ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>

        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Armed:</span>
          <span className={`${styles.statusValue} ${droneStatus.armed ? styles.statusArmed : styles.statusDisarmed}`}>
            {droneStatus.armed ? 'ARMED' : 'DISARMED'}
          </span>
        </div>

        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Mode:</span>
          <span className={styles.statusValue}>{droneStatus.flight_mode}</span>
        </div>

        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Position:</span>
          <span className={styles.statusValue}>
            ({droneStatus.position.x.toFixed(2)}, {droneStatus.position.y.toFixed(2)}, {Math.abs(droneStatus.position.z).toFixed(2)}) m
          </span>
        </div>

        <div className={styles.statusSection}>
          <span className={styles.statusLabel}>Heading:</span>
          <span className={styles.statusValue}>{droneStatus.position.yaw.toFixed(2)} RAD</span>
        </div>
      </div>
    </div>
  );
};

export default TopStatusBar;
