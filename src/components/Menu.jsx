import React from "react";
import { Link } from "react-router-dom";

const Menu = ({ setOpen, open }) => {
  return (
    <div className="menu">
      <ul>
      <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          <Link to="/services">services</Link>
        </li>
        <li>
          <Link to="/contact">contact</Link>
        </li>
        <li className="aboutbtn" onClick={() => setOpen(!open)}>
          <span>about</span>
        </li>
      </ul>
    </div>
  );
};

export default Menu;
