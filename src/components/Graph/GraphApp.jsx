import React, { useState } from "react";
import GraphCanvas from "./GraphCanvas";
import RiverCanvas from "./RiverCanvas";
import "./GraphApp.css";
import { ReactFlowProvider } from "reactflow";

export default function GraphApp() {
  const [activeView, setActiveView] = useState("river");

  return (
    <div
      style={{
        width: "100%",
        height: "100vh", // ✅ guarantees full screen height
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid #ccc" }}>


       <div
          onClick={() => setActiveView("river")}
          style={{
            padding: "0.5rem 1rem",
            borderBottom: activeView === "river" ? "2px solid black" : "none",
            fontWeight: activeView === "river" ? "bold" : "normal",
            cursor: "pointer",
          }}
        >
          River View
        </div>   

      
        <div
          onClick={() => setActiveView("graph")}
          style={{
            padding: "0.5rem 1rem",
            borderBottom: activeView === "graph" ? "2px solid black" : "none",
            fontWeight: activeView === "graph" ? "bold" : "normal",
            cursor: "pointer",
          }}
        >
          Graph View
        </div>

    
      </div>

      {/* View Panel */}
      <div style={{ flex: 1, minHeight: 0 }}> {/* ✅ Ensures child divs get full height */}
        <ReactFlowProvider>
          {activeView === "river" ? <RiverCanvas /> : <GraphCanvas />}
        </ReactFlowProvider>
      </div>
    </div>
  );
}
