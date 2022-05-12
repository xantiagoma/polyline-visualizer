import "./index.css";

var encoded = document.getElementById("encoded");
var latlng = document.getElementById("latlng");
var lnglat = document.getElementById("lnglat");

function setupMap() {
  var map = L.map("map").setView([0, 90], 2);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors | <a href="https://github.com/CartoDB/basemap-styles">CartoDB</a> layer',
      maxZoom: 18,
      id: "mapbox.streets",
      accessToken: "your.mapbox.access.token",
    }
  ).addTo(map);

  map.pm.addControls({
    position: "topleft",
    drawMarker: false,
    drawPolyline: true,
    drawRectangle: false,
    drawPolygon: false,
    drawCircle: false,
    cutPolygon: false,
    editMode: true,
    removalMode: true,
  });

  map.pm.setPathOptions({
    color: "blue",
    width: 5,
  });

  return map;
}

var io = document.getElementById("io");
var errOut = document.getElementById("error");
var map = setupMap();
var curPolyline = [];
var curMapboxPolyline = null;
var curInputMode = 0;

function disableDrawLine() {
  map.pm.addControls({
    drawPolyline: false,
  });
}

function enableDrawLine() {
  map.pm.addControls({
    drawPolyline: true,
  });
}

function syncPolyline() {
  if (curMapboxPolyline) {
    curPolyline = curMapboxPolyline.getLatLngs().map(function (item) {
      return [item.lat, item.lng];
    });
  } else {
    curPolyline = [];
  }
}

function onPmEdit() {
  syncPolyline();
  render();
}

function onPmCreate(e) {
  curMapboxPolyline = e.layer;
  curMapboxPolyline.on("pm:edit", onPmEdit);
  disableDrawLine();
  syncPolyline();
  render();
}

function onPmRemove(e) {
  curMapboxPolyline.off("pm:edit", onPmEdit);
  curMapboxPolyline = null;
  enableDrawLine();
  syncPolyline();
  render();
}

function onInput(e) {
  const val = e.target.value.trim();
  if (val === "") {
    if (curMapboxPolyline) {
      map.removeLayer(curMapboxPolyline);
    }
    enableDrawLine();
  } else {
    try {
      switch (curInputMode) {
        case 0:
          curPolyline = polyline.decode(val);
          break;
        case 1:
          curPolyline = JSON.parse(val);
          break;
        case 2:
          curPolyline = JSON.parse(val).map(function (item) {
            return [item[1], item[0]];
          });
          break;
      }
      if (!curMapboxPolyline) {
        curMapboxPolyline = L.polyline(curPolyline, {
          color: "blue",
          weight: 5,
        }).addTo(map);
        curMapboxPolyline.on("pm:edit", onPmEdit);
        map.fitBounds(curMapboxPolyline.getBounds());
        disableDrawLine();
      } else {
        curMapboxPolyline.setLatLngs(
          curPolyline.map((item) => {
            return new L.LatLng(item[0], item[1]);
          })
        );
        map.fitBounds(curMapboxPolyline.getBounds());
      }
      errOut.innerHTML = "";
    } catch (err) {
      errOut.innerHTML = err.message;
    }
  }
}

map.on("pm:create", onPmCreate);
map.on("pm:remove", onPmRemove);
io.oninput = onInput;

function setCurPolyline(encp) {
  curInputMode = 0;
  onInput({
    target: {
      value: encp,
    },
  });
  render();
  return false;
}

function render() {
  let val = "";
  switch (curInputMode) {
    case 0:
      val = polyline.encode(curPolyline);
      break;
    case 1:
      val = JSON.stringify(curPolyline, null, 2);
      break;
    case 2:
      val = JSON.stringify(
        curPolyline.map(function (item) {
          return [item[1], item[0]];
        }),
        null,
        2
      );
      break;
  }
  if (io.value !== val) {
    io.value = val;
  }

  const tags = document.getElementsByClassName("tab");
  for (var i = 0; i < tags.length; i++) {
    if (i === curInputMode) {
      tags[i].classList.add("active");
    } else {
      tags[i].classList.remove("active");
    }
  }

  return false;
}

function setDisplay(str) {
  const selectionStart = io.selectionStart;
  const selectionEnd = io.selectionEnd;
  console.log(selectionStart, selectionEnd);
  io.value = str;
  io.setSelectionRange(selectionStart, selectionEnd);
}

function chaneCurInputMode(displayType) {
  curInputMode = displayType;
  render();
  return false;
}

encoded.onclick = () => chaneCurInputMode(0);
latlng.onclick = () => chaneCurInputMode(1);
lnglat.onclick = () => chaneCurInputMode(2);
